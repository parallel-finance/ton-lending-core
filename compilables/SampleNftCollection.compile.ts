import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/nft/sample-nft-collection.tact',
    options: {
        debug: true,
    },
};
