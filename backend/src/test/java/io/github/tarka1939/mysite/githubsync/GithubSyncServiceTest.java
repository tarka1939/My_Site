package io.github.tarka1939.mysite.githubsync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import io.github.tarka1939.mysite.MalformedWebhookPayloadException;

import tools.jackson.databind.ObjectMapper;

/**
 * The record-and-announce half, isolated from HTTP and the database. The
 * insert-once-under-concurrency behaviour this depends on is not testable here -- a mock will
 * return whatever it is told -- so it is proved against a real Postgres in
 * {@code GithubWebhookIdempotencyIntegrationTest}. What is worth testing here is the branch
 * logic around that return value, and the payload reading.
 */
class GithubSyncServiceTest {

    private GithubSyncRecordRepository repository;
    private ApplicationEventPublisher eventPublisher;
    private GithubSyncService service;

    @BeforeEach
    void setUp() {
        repository = mock(GithubSyncRecordRepository.class);
        eventPublisher = mock(ApplicationEventPublisher.class);
        service = new GithubSyncService(repository, eventPublisher, new ObjectMapper());
    }

    private static byte[] body(String json) {
        return json.getBytes(StandardCharsets.UTF_8);
    }

    private void stubInsertResult(int affectedRows) {
        when(repository.insertIfAbsent(any(), anyString(), anyString(), any(), anyString()))
            .thenReturn(affectedRows);
    }

    @Test
    void recordsAndPublishesOnceWhenTheDeliveryIsNew() {
        stubInsertResult(1);

        GithubWebhookAck ack = service.accept(
            "delivery-1", "push", body("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}"));

        assertThat(ack.status()).isEqualTo(GithubWebhookAck.Status.RECORDED);
        assertThat(ack.deliveryId()).isEqualTo("delivery-1");

        ArgumentCaptor<GithubDeliveryReceivedEvent> event =
            ArgumentCaptor.forClass(GithubDeliveryReceivedEvent.class);
        verify(eventPublisher).publishEvent(event.capture());
        assertThat(event.getValue().deliveryId()).isEqualTo("delivery-1");
        assertThat(event.getValue().eventType()).isEqualTo("push");
        assertThat(event.getValue().repoFullName()).isEqualTo("tarka1939/My_Site");
        assertThat(event.getValue().recordId()).isNotNull();
    }

    @Test
    void publishesNothingWhenTheDeliveryWasAlreadyRecorded() {
        stubInsertResult(0);

        GithubWebhookAck ack = service.accept("delivery-1", "push", body("{}"));

        assertThat(ack.status()).isEqualTo(GithubWebhookAck.Status.DUPLICATE);
        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    @Test
    void theEventCarriesTheSameRecordIdThatWasInserted() {
        stubInsertResult(1);

        service.accept("delivery-1", "push", body("{}"));

        ArgumentCaptor<UUID> insertedId = ArgumentCaptor.forClass(UUID.class);
        verify(repository).insertIfAbsent(insertedId.capture(), anyString(), anyString(), any(), anyString());
        ArgumentCaptor<GithubDeliveryReceivedEvent> event =
            ArgumentCaptor.forClass(GithubDeliveryReceivedEvent.class);
        verify(eventPublisher).publishEvent(event.capture());

        assertThat(event.getValue().recordId()).isEqualTo(insertedId.getValue());
    }

    @Test
    void storesTheBodyVerbatim() {
        stubInsertResult(1);
        String awkward = "{\n  \"zeta\":1,\n\t\"repository\": {\"full_name\": \"a/b\"}\n}";

        service.accept("delivery-1", "push", body(awkward));

        verify(repository).insertIfAbsent(any(), eq("delivery-1"), eq("push"), eq("a/b"), eq(awkward));
    }

    /**
     * An organization-level {@code ping} carries no {@code repository} object. Recording it
     * anyway is the point: refusing would leave a delivery id unrecorded, so its redelivery
     * would look new -- a hole in idempotency exactly where the payload is unusual.
     */
    @Test
    void recordsADeliveryThatNamesNoRepository() {
        stubInsertResult(1);

        GithubWebhookAck ack = service.accept("delivery-ping", "ping", body("{\"zen\":\"Keep it logically awesome.\"}"));

        assertThat(ack.status()).isEqualTo(GithubWebhookAck.Status.RECORDED);
        verify(repository).insertIfAbsent(any(), eq("delivery-ping"), eq("ping"), isNull(), anyString());
    }

    @Test
    void treatsANonStringRepositoryNameAsAbsentRatherThanStringifyingIt() {
        stubInsertResult(1);

        service.accept("delivery-1", "push", body("{\"repository\":{\"full_name\":12345}}"));

        verify(repository).insertIfAbsent(any(), anyString(), anyString(), isNull(), anyString());
    }

    @Test
    void rejectsABodyThatIsNotValidJson() {
        assertThatThrownBy(() -> service.accept("delivery-1", "push", body("{not json")))
            .isInstanceOf(MalformedWebhookPayloadException.class)
            .hasMessageContaining("not valid JSON");

        verify(repository, never()).insertIfAbsent(any(), anyString(), anyString(), any(), anyString());
        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    @Test
    void rejectsABodyThatIsValidJsonButNotAnObject() {
        assertThatThrownBy(() -> service.accept("delivery-1", "push", body("[1,2,3]")))
            .isInstanceOf(MalformedWebhookPayloadException.class)
            .hasMessageContaining("not a JSON object");

        verify(repository, never()).insertIfAbsent(any(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void rejectsARepositoryNameTooLongForTheColumnRatherThanLettingTheInsertFail() {
        String overlong = "o/" + "x".repeat(GithubSyncService.MAX_REPO_FULL_NAME_LENGTH);

        assertThatThrownBy(() -> service.accept(
            "delivery-1", "push", body("{\"repository\":{\"full_name\":\"" + overlong + "\"}}")))
            .isInstanceOf(MalformedWebhookPayloadException.class)
            .hasMessageContaining("repository.full_name");

        verify(repository, never()).insertIfAbsent(any(), anyString(), anyString(), any(), anyString());
    }
}
