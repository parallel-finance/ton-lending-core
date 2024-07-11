import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/misc/TestJettonReceive.tact',
    options: {
        debug: true,
    },
};
