package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import org.apache.catalina.util.ServerInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

/**
 * pom.xml overrides some of the versions Spring Boot's parent manages, to take a library past an
 * advisory before the parent does (#272). An override outlives its reason silently, and worse
 * than its npm counterpart: a Maven version property pins rather than sets a floor, so once the
 * parent moves past it, it holds the library <em>back</em>. So each override is listed here with
 * the version that fixes its advisories, and this class fails in the build that makes one
 * unnecessary -- the one that upgrades the parent -- saying to delete it. The frontend's
 * {@code dependency-overrides.spec.ts} does the same for package.json.
 *
 * <p>"What the parent would manage" is read from the {@code spring-boot-dependencies} pom in the
 * local Maven repository, whose path surefire passes in. The overrides replace the parent's
 * values in the effective model, so nothing on the test classpath remembers them.
 */
class DependencyOverridesTest {

    /**
     * @param property the version property pom.xml sets
     * @param fixedIn the lowest version that fixes every advisory the override exists for
     * @param reason the issue and advisories, for the failure message
     * @param inUse every version of the library actually on the classpath
     */
    record VersionOverride(String property, String fixedIn, String reason, Supplier<List<String>> inUse) {
        @Override
        public String toString() {
            return property;
        }
    }

    static final List<VersionOverride> OVERRIDES = List.of(
        new VersionOverride("tomcat.version", "11.0.25",
            "#272: GHSA-h3x4-894j-xpx5, GHSA-9xv2-5v5q-p794 and GHSA-gcx9-497g-6cp6",
            () -> List.of(ServerInfo.getServerNumber())),
        new VersionOverride("jackson-bom.version", "3.1.7",
            "#272: nine advisories against jackson-core and jackson-databind 3.1.4, the last fixed in 3.1.7",
            () -> List.of(
                tools.jackson.core.json.PackageVersion.VERSION.toString(),
                tools.jackson.databind.cfg.PackageVersion.VERSION.toString()))
    );

    static Stream<VersionOverride> overrides() {
        return OVERRIDES.stream();
    }

    @Test
    void theOverridesAreExactlyTheOnesListedHere_soEachHasAStatedReasonToBeRemoved() {
        Map<String, String> managed = parentManaged();
        List<String> declared = properties(pom("project.pom")).keySet().stream()
            .filter(managed::containsKey)
            .sorted()
            .toList();

        assertThat(declared)
            .as("pom.xml properties that override a version the Spring Boot parent manages")
            .containsExactlyElementsOf(OVERRIDES.stream().map(VersionOverride::property).sorted().toList());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("overrides")
    void eachOverride_leavesNoVersionOlderThanItsFix(VersionOverride override) {
        assertThat(override.inUse().get())
            .as("%s on the classpath, which must be at least %s (%s)", override.property(),
                override.fixedIn(), override.reason())
            .allMatch(version -> atLeast(version, override.fixedIn()));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("overrides")
    void eachOverride_isStillNeeded(VersionOverride override) {
        String parentVersion = parentManaged().get(override.property());

        assertThat(parentVersion)
            .as("the Spring Boot parent no longer manages %s, so the override does nothing; "
                + "delete it from pom.xml and from OVERRIDES in this file", override.property())
            .isNotNull();
        assertThat(atLeast(parentVersion, override.fixedIn()))
            .as("the Spring Boot parent now manages %s %s, which already includes the fix in %s. "
                + "Delete the property from pom.xml and from OVERRIDES in this file: left in, it "
                + "pins the library and will hold it back the next time the parent moves.",
                override.property(), parentVersion, override.fixedIn())
            .isFalse();
    }

    private static Map<String, String> parentManaged() {
        return properties(pom("spring-boot.dependencies-pom"));
    }

    /** A path surefire passes in from pom.xml; throws rather than guessing when run outside Maven. */
    private static Path pom(String systemProperty) {
        String value = System.getProperty(systemProperty);
        if (value == null) {
            throw new IllegalStateException(systemProperty + " is not set. Run this through Maven "
                + "(mvn test), whose surefire configuration in pom.xml sets it.");
        }
        Path path = Path.of(value);
        if (!Files.isRegularFile(path)) {
            throw new IllegalStateException(systemProperty + " names " + path + ", which does not exist");
        }
        return path;
    }

    /**
     * The direct children of {@code <project><properties>}. Only the top-level block: a
     * profile's {@code <properties>} applies only when the profile does.
     */
    private static Map<String, String> properties(Path pom) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            Element project = factory.newDocumentBuilder().parse(pom.toFile()).getDocumentElement();

            Map<String, String> properties = new TreeMap<>();
            for (Node section = project.getFirstChild(); section != null; section = section.getNextSibling()) {
                if (section instanceof Element element && element.getTagName().equals("properties")) {
                    for (Node p = element.getFirstChild(); p != null; p = p.getNextSibling()) {
                        if (p instanceof Element property) {
                            properties.put(property.getTagName(), property.getTextContent().trim());
                        }
                    }
                }
            }
            return properties;
        } catch (Exception e) {
            throw new IllegalStateException("could not read the properties of " + pom, e);
        }
    }

    private static final Pattern VERSION = Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)");

    /**
     * Compares the first three numeric parts, ignoring anything after them: Tomcat reports
     * itself as {@code 11.0.26.0}. Throws on anything else rather than guessing.
     */
    static boolean atLeast(String version, String floor) {
        int[] a = parse(version);
        int[] b = parse(floor);
        for (int i = 0; i < 3; i++) {
            if (a[i] != b[i]) {
                return a[i] > b[i];
            }
        }
        return true;
    }

    private static int[] parse(String version) {
        Matcher m = VERSION.matcher(version);
        if (!m.lookingAt()) {
            throw new IllegalArgumentException("not an x.y.z version: " + version);
        }
        return new int[] {Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))};
    }
}
