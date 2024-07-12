import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/jetton/assetToken/atoken.tact',
    options: {
        debug: true,
    },
};
