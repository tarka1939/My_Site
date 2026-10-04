package io.github.tarka1939.mysite;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.tomcat.ConfigurableTomcatWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Tells Tomcat that TLS ends before a request reaches it (#260).
 *
 * <h2>Why</h2>
 * In production TLS ends at Cloudflare and the Mikrus nginx, and this app listens on plain HTTP.
 * Left alone, Tomcat reports every request as {@code http} and not secure, and two things follow:
 * Spring Security's HSTS writer, which only answers secure requests, never sends
 * {@code Strict-Transport-Security}; and every absolute URL built from a request says
 * {@code http://}, the resource metadata of #256 among them.
 *
 * <h2>Why the scheme is stated rather than read from {@code X-Forwarded-Proto}</h2>
 * Cloudflare answers plain HTTP with a 301 to HTTPS, so every request that reaches the app through
 * the edge arrived over HTTPS. That is a fact about the deployment, so it is configured once, on
 * the connector, which is the use Tomcat documents for {@code scheme} and {@code secure}. Deriving
 * it per request would mean {@code server.forward-headers-strategy}, and that also rewrites
 * {@code getRemoteAddr()}, which {@link ClientIpResolver} depends on (see its Javadoc). These two
 * attributes change {@code getScheme()} and {@code isSecure()} and nothing else. The port still
 * comes from the {@code Host} header, and with none, as the proxy sends it, Tomcat takes the
 * scheme's default, 443.
 *
 * <p>A request that bypasses Cloudflare and reaches the app over plain HTTP is also called secure.
 * Nothing here depends on that being true: there are no cookies to mark {@code Secure}, and a
 * browser ignores HSTS received over HTTP.
 *
 * <p>Off unless {@code app.tls-terminated-upstream} says otherwise, which only
 * {@code application-prod.yml} does: on {@code localhost} the requests really are plain HTTP. A
 * value that is not a boolean fails startup.
 */
@Configuration
public class UpstreamTlsConfig {

    @Bean
    public WebServerFactoryCustomizer<ConfigurableTomcatWebServerFactory> upstreamTlsCustomizer(
            @Value("${app.tls-terminated-upstream:false}") boolean tlsTerminatedUpstream) {
        return factory -> {
            if (!tlsTerminatedUpstream) {
                return;
            }
            factory.addConnectorCustomizers(connector -> {
                connector.setScheme("https");
                connector.setSecure(true);
            });
        };
    }
}
