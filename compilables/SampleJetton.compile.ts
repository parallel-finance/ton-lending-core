import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/jetton/sample-jetton.tact',
    options: {
        debug: true,
    },
};
