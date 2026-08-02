import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { ApiProblem } from '../../../core/http/api-problem';

type LinkGroup = FormGroup<{ label: FormControl<string>; url: FormControl<string> }>;

@Component({
  selector: 'app-admin-project-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './admin-project-form.component.html',
  styleUrl: './admin-project-form.component.scss',
})
export class AdminProjectFormComponent {
  private readonly projectsApi = inject(ProjectsService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly projectId = this.route.snapshot.paramMap.get('id');
  protected readonly isEditMode = this.projectId !== null;
  protected readonly loading = signal(this.isEditMode);
  protected readonly submitting = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.required, Validators.maxLength(5000)]],
    tags: ['', Validators.required],
    links: new FormArray<LinkGroup>([]),
    images: new FormArray<FormControl<string>>([]),
  });

  constructor() {
    if (this.projectId) {
      this.projectsApi.getProject({ id: this.projectId }).subscribe({
        next: (project) => {
          this.form.patchValue({
            title: project.title,
            description: project.description,
            tags: project.tags.map((t) => t.name).join(', '),
          });
          project.links.forEach((link) => this.form.controls.links.push(this.buildLinkGroup(link.label, link.url)));
          project.images.forEach((image) =>
            this.form.controls.images.push(this.buildImageControl(image)),
          );
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  protected addLink(): void {
    this.form.controls.links.push(this.buildLinkGroup());
  }

  protected removeLink(index: number): void {
    this.form.controls.links.removeAt(index);
  }

  protected addImage(): void {
    this.form.controls.images.push(this.buildImageControl());
  }

  protected removeImage(index: number): void {
    this.form.controls.images.removeAt(index);
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const tags = raw.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const writeRequest = { title: raw.title, description: raw.description, tags, links: raw.links, images: raw.images };

    this.submitting.set(true);
    this.fieldErrors.set({});

    const request$ = this.projectId
      ? this.projectsApi.updateProject({ id: this.projectId, projectWriteRequest: writeRequest })
      : this.projectsApi.createProject({ projectWriteRequest: writeRequest });

    request$.subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigateByUrl('/admin/projects');
      },
      error: (problem: ApiProblem) => {
        this.submitting.set(false);
        if (problem.fieldErrors.length > 0) {
          this.fieldErrors.set(Object.fromEntries(problem.fieldErrors.map((e) => [e.field, e.message])));
        }
        // Non-field errors are surfaced globally by errorInterceptor.
      },
    });
  }

  private buildLinkGroup(label = '', url = ''): LinkGroup {
    return this.formBuilder.nonNullable.group({
      label: [label, Validators.required],
      url: [url, Validators.required],
    });
  }

  private buildImageControl(url = ''): FormControl<string> {
    return this.formBuilder.nonNullable.control(url, Validators.required);
  }
}
