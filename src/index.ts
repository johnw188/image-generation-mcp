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
        prompt: z.string().describe("The prompt for image generation"),
        model: z
          .enum(["stable-diffusion-xl", "dall-e-3"])
          .optional()
          .describe("The model to use for image generation"),
        size: z
          .enum(["1024x1024", "512x512", "256x256"])
          .optional()
          .describe("The size of the generated image"),
      },
      async ({ prompt, model = "stable-diffusion-xl", size = "1024x1024" }) => {
        // Placeholder for image generation logic
        // In a real implementation, you would call your image generation service here
        const userInfo = this.props
          ? `Requested by ${this.props.name} (${this.props.email})`
          : "Requested by anonymous user";

        return {
          content: [
            {
              type: "text",
              text: `Generated image for prompt: "${prompt}"\nModel: ${model}\nSize: ${size}\n${userInfo}`,
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
