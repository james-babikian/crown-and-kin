// A build-time switch of `esbuild.config.mjs`: true only in the build that `npm run harness:install` makes. Absent in tests.
declare const __DYNASTY_HARNESS__: boolean | undefined;
