module.exports = {
  moduleFileExtensions: ['ts', 'js'],
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/helpers/supertestLoopback.ts'],
  testRegex: '^.+\\.spec\\.ts$',
  // transpile only: the type-level assertions of the tests (`@ts-expect-error`, expectExact) are checked by
  // `npm run ts:check-tests` (tsc --noEmit -p tsconfig.tests.json), TypeScript 7 has no JS API for ts-jest
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
        module: { type: 'commonjs' },
      },
    ],
  },
}
