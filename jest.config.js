module.exports = {
  moduleFileExtensions: ['ts', 'js'],
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/helpers/supertestLoopback.ts'],
  testRegex: '^.+\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
}
