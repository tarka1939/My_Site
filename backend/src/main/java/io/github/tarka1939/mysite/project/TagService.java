package io.github.tarka1939.mysite.project;

import java.util.List;

import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TagService {

    private final TagRepository tagRepository;

    public TagService(TagRepository tagRepository) {
        this.tagRepository = tagRepository;
    }

    @Transactional(readOnly = true)
    public List<TagResponse> listTags() {
        return tagRepository.findAll(Sort.by(Sort.Direction.ASC, "name")).stream()
            .map(TagResponse::from)
            .toList();
    }
}
