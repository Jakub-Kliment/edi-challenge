import type { NextConfig } from "next";

const config: NextConfig = {
  // sharp ships native binaries; keep it external so the bundler does not try
  // to inline them into the serverless function.
  serverExternalPackages: ["sharp"],
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo root on dev-server start.
  // Not project content, so keep them out.
  agentRules: false,
};

export default config;
