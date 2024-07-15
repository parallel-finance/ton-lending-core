import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/misc/TestMathUtils.tact',
    options: {
        debug: true,
    },
};
