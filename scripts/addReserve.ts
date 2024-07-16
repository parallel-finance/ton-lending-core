import { Address, address, OpenedContract, toNano } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import { SampleJetton } from '../wrappers/SampleJetton';
import { buildOnchainMetadata } from './utils';

const RAY = 10n ** 27n;

const addFirstReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    // Add SAM
    const reserveAddress = address('EQAFy5Wqx0HmUVQFcSTNpceFAVa8WikjyIUvWxdbqd0BsE6D');
    const sampleJetton = provider.open(SampleJetton.fromAddress(reserveAddress));
    const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',

        // TODO: change to real addresses
        poolWalletAddress,
        aTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,

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
    };

    const aTokenJettonParams = {
        name: 'SAM AToken',
        description: 'Sample Jetton aToken 2',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aSAM',
    };
    const aTokenContent = buildOnchainMetadata(aTokenJettonParams);

    const dTokenJettonParams = {
        name: 'SAM DToken',
        description: 'Sample Jetton dToken 2',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'dSAM',
    };
    const dTokenContent = buildOnchainMetadata(dTokenJettonParams);
    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent,
    };

    const calculateATokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, sampleJetton.address);
    await sleep(2000);
    console.log(`calculateATokenAddress: ${calculateATokenAddress.toString()}`);

    const calculateDTokenAddress = await pool.getCalculateDTokenAddress(contents.dTokenContent, sampleJetton.address);
    await sleep(2000);
    console.log(`calculateDTokenAddress: ${calculateDTokenAddress.toString()}`);

    reserveConfiguration.aTokenAddress = calculateATokenAddress;
    reserveConfiguration.dTokenAddress = calculateDTokenAddress;

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

    let targetReserveLength = 1n;
    let currentReserveLength = await pool.getReservesLength();
    let i = 0;
    while (currentReserveLength !== targetReserveLength && i < 20) {
        await sleep(2000);
        currentReserveLength = await pool.getReservesLength();
        i++;
        console.log(`Waiting for first reserve to be added... ${i}`);
    }
    console.log('First reserve added');
};

const addSecondReserve = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    // add MAS
    const reserveAddress = address('EQCP_v_hh0uTHIG_j6jpynQhazw3m1ZyEPR_aQMQTAsHMPxA');
    const sampleJetton = provider.open(SampleJetton.fromAddress(reserveAddress));

    await sleep(2000);
    const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',
        poolWalletAddress,
        aTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,

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
    };

    const aTokenJettonParams = {
        name: 'MAS AToken',
        description: 'Sample Jetton MAS aToken 2',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aMAS',
    };
    const aTokenContent = buildOnchainMetadata(aTokenJettonParams);

    const dTokenJettonParams = {
        name: 'MAS DToken',
        description: 'Sample Jetton MAS dToken 2',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'dMAS',
    };
    const dTokenContent = buildOnchainMetadata(dTokenJettonParams);
    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent,
    };

    const calculateATokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, sampleJetton.address);
    await sleep(2000);
    console.log(`calculateATokenAddress: ${calculateATokenAddress.toString()}`);

    const calculateDTokenAddress = await pool.getCalculateDTokenAddress(contents.dTokenContent, sampleJetton.address);
    await sleep(2000);
    console.log(`calculateATokenAddress: ${calculateDTokenAddress.toString()}`);

    reserveConfiguration.aTokenAddress = calculateATokenAddress;
    reserveConfiguration.dTokenAddress = calculateDTokenAddress;

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
    let targetReserveLength = 2n;
    let currentReserveLength = await pool.getReservesLength();
    let i = 0;
    while (currentReserveLength !== targetReserveLength && i < 20) {
        await sleep(2000);
        currentReserveLength = await pool.getReservesLength();
        i++;
        console.log(`Waiting for second reserve to be added... ${i}`);
    }
    console.log('Second reserve added');
};

const printCurrentReserveLength = async (provider: NetworkProvider, pool: OpenedContract<Pool>) => {
    const currentReserveLength = await pool.getReservesLength();
    console.log(`Current reserve length: ${currentReserveLength}`);
};

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    await sleep(1000);

    const beforeReserveLength = await pool.getReservesLength();
    if (beforeReserveLength > 0) {
        console.log(`Reserves already added, current reserve length: ${beforeReserveLength}`);
        return;
    }
    console.log(`Before reserve length: ${beforeReserveLength}`);

    await sleep(1000);
    await addFirstReserve(provider, pool);
    await addSecondReserve(provider, pool);
    const currentReserveLength = await pool.getReservesLength();
    console.log(`Current reserve length: ${currentReserveLength}`);
}
