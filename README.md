# Tonlayer protocol

## What is Tonlayer protocol?

Tonlayer protocol is a decentralized money market protocol on the TON blockchain. It allows users to supply liquidity to the pool and borrow assets from the pool. The protocol is designed to be composable, allowing users to supply liquidity to the pool and borrow assets from the pool.

##  Functions

### Admin

The admin is the owner of the pool. The admin can manage the pool.

The admin can perform the following actions:
- The admin can support a new token in the pool
- The admin can remove a token from the pool
- The admin can change the configs like fee/ltv for the pool
- The admin can stop/resume the pool
- The admin can mint collected fees to the treasury as lToken

### Liquidity provider and borrower

Once the token is supplied to the pool, the liquidity provider will receive the aToken(Asset token).
The aToken can be used to withdraw the liquidity from the pool.
The ratio of aToken to token will increase as time passes because of the interest.

The liquidity provider can perform the following actions:
- The liquidity provider can deposit liquidity in the pool
- The liquidity provider can withdraw liquidity from the pool

The borrower can borrow the tokens from the pool by depositing the collateral in the pool.
The borrower will receive the dToken(Debt token) which represents the debt of the borrower.
The ratio of dToken to token will increase as time passes because of the interest.

- The borrower can borrow the tokens from the pool
- The borrower can repay the borrowed tokens to the pool

### Liquidator

The liquidator can liquidate the position of the borrower if the borrower's position is under collateralized.

The liquidator can perform the following actions:
- The liquidator can liquidate the position of the borrower. The liquidator can only liquidate one position at a time.


## Getting started

###  Project structure

- `contracts` - source code of all the smart contracts of the project and their dependencies
- `wrappers` - wrapper classes (implementing `Contract` from ton-core) for the contracts, including any [de]serialization primitives and compilation functions
- `tests` - tests for the contracts
- `scripts` - scripts used by the project, mainly the deployment scripts
- `compilables`- the contracts compile config
- `helpers` - helper functions used by the project

### Deploying the contracts and preparing the environment

We are using pnpm and use p as the pnpm alias. If you are using npm or yarn, you can replace p with npm or yarn.

1. Install the dependencies

```bash
p install
``` 
2. Build the contracts

```bash
p build:all
```

3. Deploy the pool

```bash
p start deployPool
```

4. Add reserves

It will use the deployed tokens as the reserve    
```bash
p start addReserve
p start setOraclePrice
```

5. Mint test tokens
You can add the jettonAddress after the command or input it when prompted
```bash
p start mintJetton ${jettonAddress}
```

6. Play with pool
```bash
p start supplyJetton
p start borrowJetton
p start repayJetton
p start withdrawJetton

p start supplyTon
p start borrowTon
p start repayTon
p start withdrawTon
```

7. Liquidate the position
```bash
p start findToLiquidateUser
# update the user address to liquidate
p start liquidateUser
```



