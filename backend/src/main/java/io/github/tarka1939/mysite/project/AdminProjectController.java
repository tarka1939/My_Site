package io.github.tarka1939.mysite.project;

import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.github.tarka1939.mysite.PageResponse;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * The admin's read side: every project, drafts included.
 *
 * <p>A separate controller on a separate path rather than a flag on {@link ProjectController},
 * and that is the security design rather than a filing preference. The public endpoints run
 * queries whose JPQL names {@code published = true} as a literal, so no argument, header or
 * authentication state can widen them; a draft reaching the public site would take a change to
 * the query, not a mistake about who is calling. Phase 7a makes that worth paying for, because
 * a draft is no longer only something the owner made and left alone -- it is auto-created from
 * whatever repositories get pushed, which can include private ones.
 *
 * <p>Everything here is denied by default twice over: {@code /api/v1/admin/**} matches no
 * {@code permitAll} rule in {@code SecurityConfig}, so it falls to {@code anyRequest()
 * .authenticated()}, and the class-level {@code @PreAuthorize} then requires the ADMIN role
 * specifically. The write endpoints stay on {@code /api/v1/projects} where they always were --
 * they were never public, so moving them would be a breaking change buying nothing.
 */
@RestController
@RequestMapping("/api/v1/admin/projects")
@Validated
@PreAuthorize("hasRole('ADMIN')")
public class AdminProjectController {

    private final ProjectService projectService;

    public AdminProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    @GetMapping
    public ResponseEntity<PageResponse<ProjectResponse>> listAllProjects(
        @RequestParam(defaultValue = "0") @Min(0) int page,
        @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
        @RequestParam(required = false) List<String> tag
    ) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ResponseEntity.ok(projectService.listAllProjects(pageable, tag));
    }

    /** Any project by id, draft or published -- 404 here means the id really does not exist. */
    @GetMapping("/{id}")
    public ResponseEntity<ProjectResponse> getAnyProject(@PathVariable UUID id) {
        return ResponseEntity.ok(projectService.getProject(id));
    }
}
