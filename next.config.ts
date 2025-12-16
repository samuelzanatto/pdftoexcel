import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configurar módulos externos para não serem bundlados
  // Isso permite que pdfjs-dist e canvas funcionem com workers
  serverExternalPackages: ['pdfjs-dist', 'canvas', 'pdf-to-img'],
};

export default nextConfig;
