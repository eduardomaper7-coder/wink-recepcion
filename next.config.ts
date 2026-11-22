import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Paquetes nativos/Node que no deben empaquetarse en el bundle del servidor
  serverExternalPackages: ['sharp', 'imapflow', 'nodemailer', 'mailparser', '@react-pdf/renderer'],
  // Archivos que deben viajar con las funciones serverless en Vercel
  outputFileTracingIncludes: {
    '/api/demo': ['./demo/fixtures/**/*'],
    '/api/projects/[id]/pdf': ['./public/brand/**/*', './public/fonts/**/*'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
