import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";
import { createRouter } from "./router";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MyMCP as this.props
type Props = {
  name: string;
  email: string;
  accessToken: string;
};

export class MyMCP extends McpAgent<Props, Env> {
  server = new McpServer({
    name: "Image Generation MCP Server",
    version: "0.0.1",
  });

  async init() {
    // Image generation tool
    this.server.tool(
      "generate_image",
      "Generate an image using the Flux 1 Schnell diffusion model. This model excels at creating high-quality images from detailed text descriptions. For best results, provide clear, descriptive prompts that specify style, composition, colors, and mood. The model understands complex scenes and artistic styles. The tool will return a URL where the generated image is hosted.",
      {
        prompt: z.string().describe("The text description of the image you want to generate"),
      },
      async ({ prompt }) => {
        try {
          const userInfo = this.props
            ? `${this.props.name} (${this.props.email})`
            : "anonymous user";

          // Use Flux model for fast, high-quality generation
          const response = await this.env.AI.run(
            "@cf/black-forest-labs/flux-1-schnell",
            { 
              prompt, 
              steps: 8,
            }
          ) as any;
          
          // Cloudflare AI returns an object with an 'image' property containing base64 data
          if (!response || typeof response !== 'object' || !('image' in response)) {
            throw new Error(`Invalid response from AI model`);
          }

          const base64Image = response.image;

          // Convert base64 to binary data for R2 upload
          const binaryString = atob(base64Image);
          const imageBuffer = Uint8Array.from(binaryString, char => char.charCodeAt(0));

          // Generate a unique filename
          const timestamp = Date.now();
          const randomId = Math.random().toString(36).substring(2, 15);
          const filename = `${timestamp}-${randomId}.jpeg`;

          // Upload to R2
          await this.env.IMAGE_BUCKET.put(filename, imageBuffer, {
            httpMetadata: {
              contentType: "image/jpeg",
            },
          });

          // Create the URL for the hosted image
          const baseUrl = this.env.WORKER_URL || "https://image-generation-mcp.code-with-claude.workers.dev";
          const imageUrl = `${baseUrl}/images/${filename}`;

          return {
            content: [
              // {
              //   type: "image",
              //   data: base64Image,
              //   mimeType: "image/jpeg",
              // },
              {
                type: "text",
                text: imageUrl,
              },
            ],
          };
        } catch (error) {
          // MCP tools should throw errors rather than return them as content
          throw new Error(
            `Failed to generate image: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }
    );
  }
}

const oauthProvider = new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: MyMCP.mount("/sse"),
  defaultHandler: GoogleHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // Token lifetime configuration (8 hours in seconds)
  tokenLifetime: 8 * 60 * 60, // 28800 seconds
});

const router = createRouter(oauthProvider);

export default router;
