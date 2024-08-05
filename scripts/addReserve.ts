import { Address, address, OpenedContract, toNano } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import { SampleJetton } from '../wrappers/SampleJetton';
import { buildOnchainMetadata, JettonMetaData } from './utils';
import { ACL } from '../helpers/constant';
import { send } from 'process';

const RAY = 10n ** 27n;

const addJettonReserve = async (
    provider: NetworkProvider,
    pool: OpenedContract<Pool>,
    reserveAddress: Address,
    aTokenJettonParams: JettonMetaData,
    dTokenJettonParams: JettonMetaData,
    targetReserveLength: bigint,
    decimals: bigint = 9n,
) => {
    await sleep(1000);
    const jetton = provider.open(SampleJetton.fromAddress(reserveAddress));
    const poolWalletAddress = await jetton.getGetWalletAddress(pool.address);

    await addReserve(
        provider,
        pool,
        poolWalletAddress,
        reserveAddress,
        aTokenJettonParams,
        dTokenJettonParams,
        targetReserveLength,
        decimals,
    );
};

const addReserve = async (
    provider: NetworkProvider,
    pool: OpenedContract<Pool>,
    poolWalletAddress: Address,
    reserveAddress: Address,
    aTokenJettonParams: JettonMetaData,
    dTokenJettonParams: JettonMetaData,
    targetReserveLength: bigint,
    decimals: bigint = 9n,
) => {
    const aTokenContent = buildOnchainMetadata(aTokenJettonParams);
    const dTokenContent = buildOnchainMetadata(dTokenJettonParams);
    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent,
    };

    const aTokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, reserveAddress);
    await sleep(2000);
    console.log(`aTokenAddress: ${aTokenAddress.toString()}`);

    const dTokenAddress = await pool.getCalculateDTokenAddress(contents.dTokenContent, reserveAddress);
    await sleep(2000);
    console.log(`dTokenAddress: ${dTokenAddress.toString()}`);

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',
        poolWalletAddress,
        aTokenAddress,
        dTokenAddress,

        ltv: 6000n,
        liquidationThreshold: 7500n,
        liquidationBonus: 10500n,
        reserveFactor: 1000n,
        liquidationProtocolFee: 500n,
        isActive: true,
        isFrozen: false,
        borrowingEnabled: true,
        supplyCap: toNano(1000000n),
        borrowCap: toNano(1000000n),
        treasury: provider.sender().address!!,
        decimals,
    };

    const reserveInterestRateStrategy: ReserveInterestRateStrategy = {
        $$type: 'ReserveInterestRateStrategy',
        optimalUsageRatio: (RAY * 9n) / 10n,
        maxUsageRatio: RAY / 10n,
        baseBorrowRate: 0n,
        slope1: (RAY * 4n) / 100n,
        slope2: (RAY * 6n) / 10n,
    };
    await sleep(2000);
    console.log('send AddReserve...');

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.1'),
        },
        {
            $$type: 'AddReserve',
            reserveAddress,
            reserveConfiguration,
            reserveInterestRateStrategy,
            contents,
        },
    );

    let currentReserveLength = await pool.getReservesLength();
    let i = 0;
    while (currentReserveLength !== targetReserveLength && i < 20) {
        await sleep(2000);
        currentReserveLength = await pool.getReservesLength();
        i++;
        console.log(`Waiting for No. ${targetReserveLength} reserve to be added... ${i}`);
    }
    console.log(`reserve added, currentReserveLength: ${currentReserveLength}`);
};

const addMasReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const aTokenJettonParams = {
        name: 'MAS aToken',
        description: 'MAS aToken',
        decimals: '9',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aMAS',
    };
    const dTokenJettonParams = {
        name: 'MAS dToken',
        description: 'MAS dToken',
        decimals: '9',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'dMAS',
    };
    await addJettonReserve(
        provider,
        pool,
        address('EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU'),
        aTokenJettonParams,
        dTokenJettonParams,
        1n,
    );
};

const addNotCoinReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const aTokenJettonParams = {
        name: 'Notcoin aToken',
        description: 'Notcoin aToken',
        decimals: '9',
        image: 'https://cache.tonapi.io/imgproxy/4KCMNm34jZLXt0rqeFm4rH-BK4FoK76EVX9r0cCIGDg/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovY2xpY2tlci9ub3RfbG9nby5wbmc.webp',
        symbol: 'aNOT',
    };

    const dTokenJettonParams = {
        name: 'Notcoin dToken',
        description: 'Notcoin dToken',
        decimals: '9',
        image: 'https://cache.tonapi.io/imgproxy/4KCMNm34jZLXt0rqeFm4rH-BK4FoK76EVX9r0cCIGDg/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovY2xpY2tlci9ub3RfbG9nby5wbmc.webp',
        symbol: 'dNOT',
    };

    await addJettonReserve(
        provider,
        pool,
        address('EQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCa4W-'),
        aTokenJettonParams,
        dTokenJettonParams,
        2n,
    );
};

const addProxyTonReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const aTokenJettonParams = {
        name: 'Proxy TON aToken',
        description: 'Proxy TON aToken',
        decimals: '9',
        image: 'https://cache.tonapi.io/imgproxy/X7T-fLahBBVIxXacXAqrsCHIgFgTQE3Jt2HAdnc5_Mc/rs:fill:200:200:1/g:no/aHR0cHM6Ly9zdGF0aWMuc3Rvbi5maS9sb2dvL3Rvbl9zeW1ib2wucG5n.webp',
        symbol: 'apTON',
    };

    const dTokenJettonParams = {
        name: 'Proxy TON dToken',
        description: 'Proxy TON dToken',
        decimals: '9',
        image: 'https://cache.tonapi.io/imgproxy/X7T-fLahBBVIxXacXAqrsCHIgFgTQE3Jt2HAdnc5_Mc/rs:fill:200:200:1/g:no/aHR0cHM6Ly9zdGF0aWMuc3Rvbi5maS9sb2dvL3Rvbl9zeW1ib2wucG5n.webp',
        symbol: 'dpTON',
    };

    await addJettonReserve(
        provider,
        pool,
        address('EQBvOgGXLdZOysRTnw2UDc_KRwcD5HLVH139DZ3AnK04LcxH'),
        aTokenJettonParams,
        dTokenJettonParams,
        3n,
    );
};

const addUSDTReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const aTokenJettonParams = {
        name: 'USDT aToken',
        description: 'USDT aToken',
        decimals: '6',
        image: 'https://cache.tonapi.io/imgproxy/T3PB4s7oprNVaJkwqbGg54nexKE0zzKhcrPv8jcWYzU/rs:fill:200:200:1/g:no/aHR0cHM6Ly90ZXRoZXIudG8vaW1hZ2VzL2xvZ29DaXJjbGUucG5n.webp',
        symbol: 'aUSDT',
    };

    const dTokenJettonParams = {
        name: 'USDT dToken',
        description: 'USDT dToken',
        decimals: '6',
        image: 'https://cache.tonapi.io/imgproxy/T3PB4s7oprNVaJkwqbGg54nexKE0zzKhcrPv8jcWYzU/rs:fill:200:200:1/g:no/aHR0cHM6Ly90ZXRoZXIudG8vaW1hZ2VzL2xvZ29DaXJjbGUucG5n.webp',
        symbol: 'dUSDT',
    };

    await addJettonReserve(
        provider,
        pool,
        address('EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu'),
        aTokenJettonParams,
        dTokenJettonParams,
        4n,
        6n,
    );
};

const addTonReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const aTokenJettonParams = {
        name: 'Ton aToken',
        description: 'Ton aToken',
        decimals: '9',
        image: 'https://cache.tonapi.io/imgproxy/X7T-fLahBBVIxXacXAqrsCHIgFgTQE3Jt2HAdnc5_Mc/rs:fill:200:200:1/g:no/aHR0cHM6Ly9zdGF0aWMuc3Rvbi5maS9sb2dvL3Rvbl9zeW1ib2wucG5n.webp',
        symbol: 'aTON',
    };

    const dTokenJettonParams = {
        name: 'Ton dToken',
        description: 'Ton dToken',
        decimals: '9',
        image: 'https://cache.tonapi.io/imgproxy/X7T-fLahBBVIxXacXAqrsCHIgFgTQE3Jt2HAdnc5_Mc/rs:fill:200:200:1/g:no/aHR0cHM6Ly9zdGF0aWMuc3Rvbi5maS9sb2dvL3Rvbl9zeW1ib2wucG5n.webp',
        symbol: 'dTON',
    };

    await addReserve(provider, pool, pool.address, pool.address, aTokenJettonParams, dTokenJettonParams, 5n, 9n);
};

const printCurrentReserveLength = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const currentReserveLength = await pool.getReservesLength();
    console.log(`Current reserve length: ${currentReserveLength}`);
};

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    // EQAQCgea8PVFW0jUIQvvGAZu9G-KsrO-Q3RO0R50Svg8tMXN
    console.log(`Start adding reserves... (pool address: ${pool.address.toString()}`);
    await sleep(1000);

    const beforeReserveLength = await pool.getReservesLength();
    if (beforeReserveLength > 0) {
        console.log(`Reserves already added, current reserve length: ${beforeReserveLength}`);
        return;
    }
    console.log(`Before reserve length: ${beforeReserveLength}`);

    if (!(await pool.getHasRole(ACL.ASSET_LISTING_ADMIN_ROLE, provider.sender().address!!))) {
        console.error(`${provider.sender().address!!} don't have the ASSET_LISTING_ADMIN_ROLE role`);
    }

    await addMasReserve(provider, pool);
    await addNotCoinReserve(provider, pool);
    await addProxyTonReserve(provider, pool);
    await addUSDTReserve(provider, pool);
    await addTonReserve(provider, pool);

    await printCurrentReserveLength(provider, pool);
}
