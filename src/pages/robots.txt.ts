export function GET({ site }: { site?: URL }) {
  const sitemap = site ? `Sitemap: ${new URL('sitemap-index.xml', site).toString()}\n` : '';
  return new Response(`User-agent: *\nDisallow: /admin/\nAllow: /\n${sitemap}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
