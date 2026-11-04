package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

/** {@link AnalyticsService#SELF_DECLARED_AUTOMATION}, the one place the bot list lives. */
class SelfDeclaredAutomationTest {

    @ParameterizedTest
    @ValueSource(strings = {
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
        "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
        "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
        "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1",
        "CCBot/2.0 (https://commoncrawl.org/faq/)",
        "SomeCrawler/1.0",
        "GPTBOT",
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) spider",
    })
    void selfDeclaredAutomationIsDropped(String userAgent) {
        assertThat(AnalyticsService.isSelfDeclaredAutomation(userAgent)).isTrue();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void aMissingOrBlankUserAgentIsDropped(String userAgent) {
        assertThat(AnalyticsService.isSelfDeclaredAutomation(userAgent)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    })
    void ordinaryBrowsersAreCounted(String userAgent) {
        assertThat(AnalyticsService.isSelfDeclaredAutomation(userAgent)).isFalse();
    }

    /** The accepted false positive, pinned so that changing it is a decision, not an accident. */
    @ParameterizedTest
    @ValueSource(strings = {
        "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    })
    void cubotPhonesAreTheKnownFalsePositive(String userAgent) {
        assertThat(AnalyticsService.isSelfDeclaredAutomation(userAgent)).isTrue();
    }
}
