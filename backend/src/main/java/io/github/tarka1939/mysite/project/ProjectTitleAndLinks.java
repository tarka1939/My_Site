package io.github.tarka1939.mysite.project;

import java.util.List;
import java.util.UUID;

/**
 * A project's title and its links as they are now, and nothing else about it.
 *
 * <p>What {@link ProjectService#findTitlesAndLinks} hands the analytics dashboard (#59) so it can
 * name the projects and links it counts. A value object owned by this module, like
 * {@link GithubRepositoryMetadata}, so no entity or repository crosses the module boundary, and
 * narrower than {@link ProjectResponse}, whose tags would cost a query per batch for nothing the
 * caller reads.
 *
 * @param id the project
 * @param title its current title, published or not
 * @param links its current links, in their stored order
 */
public record ProjectTitleAndLinks(UUID id, String title, List<Link> links) {

    public ProjectTitleAndLinks {
        links = List.copyOf(links);
    }
}
