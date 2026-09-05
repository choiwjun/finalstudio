import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export function isPublicPost(post: Post, now = new Date()): boolean {
  const { status, publishAt } = post.data;
  if (status === 'published') return !publishAt || publishAt <= now;
  return status === 'scheduled' && !!publishAt && publishAt <= now;
}

export async function getPublicPosts(now = new Date()): Promise<Post[]> {
  const posts = await getCollection('posts');
  return posts
    .filter((post) => isPublicPost(post, now))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
