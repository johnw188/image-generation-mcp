import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";

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
      {
        prompt: z.string().describe("The text description of the image you want to generate"),
        steps: z
          .number()
          .optional()
          .default(4)
          .describe("Number of diffusion steps (minimum 4, higher values can improve quality)"),
      },
      async ({ prompt, steps = 4 }) => {
        try {
          const userInfo = this.props
            ? `${this.props.name} (${this.props.email})`
            : "anonymous user";

          // Use Flux model for fast, high-quality generation
          const response = await this.env.AI.run(
            "@cf/black-forest-labs/flux-1-schnell",
            { 
              prompt, 
              steps: Math.max(steps || 4, 4) // Minimum 4 steps for quality
            }
          ) as any;
          
          // Cloudflare AI returns an object with an 'image' property containing base64 data
          if (!response || typeof response !== 'object' || !('image' in response)) {
            throw new Error(`Invalid response from AI model`);
          }

          const base64Image = response.image;

          return {
            content: [
              {
                type: "image",
                data: base64Image,
                mimeType: "image/jpeg",
              },
              {
                type: "text",
                text: `✨ Image generated successfully!\n\n**Prompt:** "${prompt}"\n**Model:** Flux 1 Schnell\n**Steps:** ${steps}\n**Generated for:** ${userInfo}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error generating image: ${error instanceof Error ? error.message : "Unknown error"}\n\nPlease try again with a different prompt.`,
              },
            ],
          };
        }
      }
    );

    // Get available AI models tool
    this.server.tool(
      "list_ai_models",
      {},
      async () => {
        return {
          content: [
            {
              type: "text",
              text: `Available AI Models on Cloudflare:

**Text to Image (Currently Using):**
• @cf/black-forest-labs/flux-1-schnell - Flux 1 Schnell (fast, high-quality)

**Other Available Models:**
• @cf/stabilityai/stable-diffusion-xl-base-1.0 - Stable Diffusion XL
• @cf/lykon/dreamshaper-8-lcm - DreamShaper (fast generation)
• @cf/bytedance/stable-diffusion-xl-lightning - SDXL Lightning (ultra-fast)

**Image to Text:**
• @cf/unum/uform-gen2-qwen-500m - Image captioning

**Text Generation:**
• @cf/meta/llama-3.2-3b-instruct - Llama 3.2 3B
• @cf/meta/llama-3.2-1b-instruct - Llama 3.2 1B
• @cf/google/gemma-7b-it-lora - Gemma 7B

**Other Models:**
• @cf/huggingface/distilbert-sst-2-int8 - Sentiment analysis
• @cf/openai/whisper - Speech to text

Note: This MCP server currently uses Flux 1 Schnell for fast, high-quality image generation.`,
            },
          ],
        };
      }
    );

    // Add a simple info tool
    this.server.tool("get_user_info", {}, async () => {
      if (!this.props) {
        return {
          content: [{ type: "text", text: "No user information available" }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `User: ${this.props.name}\nEmail: ${this.props.email}`,
          },
        ],
      };
    });
  }
}

export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: MyMCP.mount("/sse"),
  defaultHandler: GoogleHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
