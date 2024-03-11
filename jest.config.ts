import type { Config } from 'jest';
import { defaults } from 'jest-config';

const config: Config = {
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: [
    ...defaults.testPathIgnorePatterns,
    '<rootDir>/dist/',
    '<rootDir>/.lint/',
  ],
  resolver: './assume-cjs-resolver.cjs',
};

export default config;
