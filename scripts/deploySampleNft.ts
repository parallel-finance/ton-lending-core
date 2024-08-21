import { beginCell, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from './utils';
import { SampleJetton } from '../wrappers/SampleJetton';
import { NftCollection } from '../build/SampleNftCollection/tact_NftCollection';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!!;

    const metaJsonUrl =
        'https://salmon-accurate-marten-318.mypinata.cloud/ipfs/QmZsFPzMk798bmLUdx7tCNtTV8Ht9v9P4nPpDVsxAJodKj'; // Change to the content URL you prepared
    let content = beginCell().storeInt(1, 8).storeStringRefTail(metaJsonUrl).endCell();

    const nft = provider.open(
        await NftCollection.fromInit(owner, content, {
            $$type: 'RoyaltyParams',
            numerator: 35n, // 35n = 3.5%
            denominator: 1000n,
            destination: owner,
        }),
    );

    await nft.send(
        provider.sender(),
        {
            value: toNano('0.1'),
        },
        'Mint',
    );

    // NFT:
    await provider.waitForDeploy(nft.address);
    console.log(`Deployed at ${nft.address.toString()}`);
}
