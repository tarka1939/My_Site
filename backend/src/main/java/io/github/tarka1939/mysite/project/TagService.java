package io.github.tarka1939.mysite.project;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TagService {

    private final TagRepository tagRepository;

    public TagService(TagRepository tagRepository) {
        this.tagRepository = tagRepository;
    }

    /**
     * Tags currently in use — those attached to at least one project — name-ascending.
     *
     * <p>The filtering is the point, not an optimisation: this listing populates the public
     * "filter by tag" control, and an orphaned tag there is a filter value that returns an
     * empty project list on the site's front page. Orphans are filtered on read rather than
     * deleted when their last project goes; see {@link TagRepository#findAllInUseOrderByNameAsc}
     * for why, and docs/openapi.yaml for the contract that states it.
     */
    @Transactional(readOnly = true)
    public List<TagResponse> listTags() {
        return tagRepository.findAllInUseOrderByNameAsc().stream()
            .map(TagResponse::from)
            .toList();
    }
}
