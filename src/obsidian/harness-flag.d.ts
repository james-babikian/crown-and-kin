// A build-time switch of `esbuild.config.mjs`: true only in the build that `npm run harness:install` makes. Absent in tests.
declare const __DYNASTY_HARNESS__: boolean | undefined;
// Another build-time switch: true in the harness build and in the study build, which set the page-root drag switches of `move-layer.ts`. Absent in tests.
declare const __DYNASTY_SWITCHES__: boolean | undefined;
