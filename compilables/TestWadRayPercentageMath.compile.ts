import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/misc/TestWadRayPercentageMath.tact',
    options: {
        debug: true,
    },
};
