package io.github.tarka1939.mysite.analytics;

import org.springframework.security.crypto.password.PasswordEncoder;

import io.github.tarka1939.mysite.auth.AdminUser;
import io.github.tarka1939.mysite.auth.AdminUserRepository;

/** What the analytics integration tests share. Not a component: see AnalyticsEnablementTest. */
final class AnalyticsTestSupport {

    /** An ordinary desktop Chrome, which nothing in the bot pattern matches. */
    static final String BROWSER =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    static final String ADMIN_PASSWORD = "s3cure-p@ssword!";

    private AnalyticsTestSupport() {
    }

    /**
     * The same reflection as the other integration tests: the AdminUser constructor is protected
     * and this package is outside auth's. The address is an RFC 2606 {@code .invalid} one.
     */
    static void seedAdmin(AdminUserRepository repository, PasswordEncoder encoder, String username) {
        try {
            var constructor = AdminUser.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            AdminUser adminUser = constructor.newInstance();
            var usernameField = AdminUser.class.getDeclaredField("username");
            usernameField.setAccessible(true);
            usernameField.set(adminUser, username);
            var emailField = AdminUser.class.getDeclaredField("email");
            emailField.setAccessible(true);
            emailField.set(adminUser, username + "@example.invalid");
            adminUser.setPasswordHash(encoder.encode(ADMIN_PASSWORD));
            repository.saveAndFlush(adminUser);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    static String loginJson(String username) {
        return "{\"username\":\"" + username + "\",\"password\":\"" + ADMIN_PASSWORD + "\"}";
    }
}
