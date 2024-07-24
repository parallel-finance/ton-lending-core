import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFiles: ['./jest.setup.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;
