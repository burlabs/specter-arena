/**
 * The bare specifiers the Crew dashboard's import map resolves to its shared vendor
 * modules. The library build leaves every one of them external, so the bundle uses the
 * host's copies instead of shipping its own.
 */
export const HOST_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '@kirocrew/app-sdk',
  '@kirocrew/app-sdk/ui',
  '@tanstack/react-query',
  'lucide-react',
] as const;
