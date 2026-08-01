package io.github.tarka1939.mysite;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * Fails the build if a module (project/, contact/, ...) reaches into another module's
 * internals instead of going through its public API or an event — see
 * docs/DECISIONS.md's Spring Modulith ADR.
 */
class ModularityTests {

    private static final ApplicationModules MODULES = ApplicationModules.of(MySiteApplication.class);

    @Test
    void modulesAreConsistent() {
        MODULES.verify();
    }
}
