import { Hono } from 'hono';
import type { Env } from '../worker-configuration';

export function createRouter(oauthProvider: any) {
  const app = new Hono<{ Bindings: Env }>();

  // Handle image serving
  app.get('/images/*', async (c) => {
    const filename = c.req.path.slice(8); // Remove "/images/" prefix
    
    try {
      const object = await c.env.IMAGE_BUCKET.get(filename);
      
      if (!object) {
        return c.text("Image not found", 404);
      }
      
      const headers = new Headers();
      if (object.httpMetadata?.contentType) {
        headers.set("Content-Type", object.httpMetadata.contentType);
      }
      headers.set("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
      
      return new Response(object.body, { headers });
    } catch (error) {
      return c.text("Error fetching image", 500);
    }
  });

  // Delegate all other routes to the OAuth provider
  app.all('*', async (c) => {
    return oauthProvider.fetch(c.req.raw, c.env, c.executionCtx);
  });

  return app;
}