module.exports = {
  moduleFileExtensions: ['ts', 'js'],
  roots: ['<rootDir>/tests'],
  testRegex: '^.+\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
}
