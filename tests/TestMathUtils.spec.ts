import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import '@ton/test-utils';
import { TestMathUtils } from '../build/TestMathUtils/tact_TestMathUtils';
import { TestWadRayPercentageMath } from '../build/TestWadRayPercentageMath/tact_TestWadRayPercentageMath';

describe('TestMathUtils', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let mathUtils: SandboxContract<TestMathUtils>;
    let testWadRayPercentageMath: SandboxContract<TestWadRayPercentageMath>;

    const WAD = 10n ** 18n;
    const RAY = 10n ** 27n;
    const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        mathUtils = blockchain.openContract(await TestMathUtils.fromInit());
        testWadRayPercentageMath = blockchain.openContract(await TestWadRayPercentageMath.fromInit());

        const deployResult = await mathUtils.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: mathUtils.address,
            deploy: true,
            success: true,
        });

        const result = await testWadRayPercentageMath.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: testWadRayPercentageMath.address,
            deploy: true,
            success: true,
        });
    });

    it('calculateLinearInterest', async () => {
        const rate = BigInt(2) * RAY;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const lastUpdateTimestamp = now - BigInt(100);
        const expected = RAY + (rate * (now - lastUpdateTimestamp)) / SECONDS_PER_YEAR;
        const rst = await mathUtils.getCalculateLinearInterest(rate, lastUpdateTimestamp);
        expect(Number(rst) / Number(RAY)).toEqual(Number(expected) / Number(RAY));
    });

    it('calculateCompoundedInterest', async () => {
        const rate = BigInt(2) * RAY;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const lastUpdateTimestamp = now - BigInt(100);
        const exp = 100n;
        const expMinusOne = exp - 1n;
        const expMinusTwo = exp - 2n;
        const basePowerTwo = (rate * rate) / RAY / (SECONDS_PER_YEAR * SECONDS_PER_YEAR);
        const basePowerThree = (basePowerTwo * rate) / RAY / SECONDS_PER_YEAR;
        const secondTerm = (exp * expMinusOne * basePowerTwo) / 2n;
        const thirdTerm = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6n;

        const expected = RAY + (rate * exp) / SECONDS_PER_YEAR + secondTerm + thirdTerm;
        const rst = await mathUtils.getCalculateCompoundedInterest(rate, lastUpdateTimestamp);
        expect(Number(rst) / Number(RAY)).toEqual(Number(expected) / Number(RAY));
    });
});
