package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySourcesPropertyResolver;
import org.springframework.core.io.ClassPathResource;

/**
 * Which configuration file turns {@link UpstreamTlsConfig} on (#260).
 * {@link UpstreamTlsIntegrationTest} sets the property directly, so without this nothing would
 * notice the line going missing from {@code application-prod.yml}, and production would quietly
 * go back to sending no HSTS.
 *
 * <p>Each file is read on its own and its placeholders resolved against nothing else, so the
 * result is the file's default and not whatever the machine running the test has in its
 * environment.
 */
class UpstreamTlsConfigTest {

    private static Boolean resolve(String file) throws IOException {
        MutablePropertySources sources = new MutablePropertySources();
        new YamlPropertySourceLoader().load(file, new ClassPathResource(file)).forEach(sources::addLast);
        return new PropertySourcesPropertyResolver(sources)
            .getProperty("app.tls-terminated-upstream", Boolean.class);
    }

    @Test
    void theProdProfileTurnsItOn() throws IOException {
        assertThat(resolve("application-prod.yml")).isTrue();
    }

    @Test
    void theBaseConfigurationLeavesItOff() throws IOException {
        assertThat(resolve("application.yml")).isFalse();
    }
}
