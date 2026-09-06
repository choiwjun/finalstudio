import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    pubDate: z.coerce.date(),
    publishAt: z.coerce.date().optional(),
    status: z.enum(['draft', 'scheduled', 'published']),
    // 카테고리는 특정 주제에 묶지 않는다. 새 블로그 주제는 frontmatter에 추가한다.
    topic: z.string().min(1),
    angle: z.string().min(1),
    author: z.string().min(1),
    sourceIds: z.array(z.string()).default([]),
    testedAt: z.coerce.date().optional(),
    toolVersions: z.record(z.string(), z.string()).default({}),
    manualReview: z.enum(['none', 'required', 'approved']).default('none'),
    manualReviewReasons: z.array(z.string()).default([]),
    aiAssisted: z.boolean().default(true),
    difficulty: z.enum(['초급', '중급', '고급']).optional(),
    series: z.string().min(1).optional(),
    seriesOrder: z.coerce.number().int().positive().optional(),
    canonical: z.string().url().optional(),
    image: z.string().optional(),
  }),
});

export const collections = { posts };
