/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'


const WETH_ADDRESS = '0x8a419ef4941355476cf04933e90bf3bbf2f73814'
const USDC_WETH_PAIR = '0xc6eeff592c8037ae513801d758e496b3b896976d' // created 10008355
const DAI_WETH_PAIR = '0xa5d580c8a994e25117bc0f7ee396e8ed81a8fb69' // created block 10042267
const USDT_WETH_PAIR = '0xa46937e3629dd2b54b77ad238c646d1fbdc5ee10' // created block 10093341
const BUSD_WETH_PAIR = '0x91ddc91400fb1c215da5fdf4623d3f705f5f9024'

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let daiPair = Pair.load(DAI_WETH_PAIR) // dai is token0
  let usdcPair = Pair.load(USDC_WETH_PAIR) // usdc is token0
  let usdtPair = Pair.load(USDT_WETH_PAIR) // usdt is token1
  let busdPair = Pair.load(BUSD_WETH_PAIR) // usdt is token0

  // all 3 have been created
  if (busdPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityETH = busdPair.reserve0.plus(usdcPair.reserve0).plus(usdtPair.reserve0)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH)
    return busdPair.token1Price
      .times(busdWeight)
      .plus(usdcPair.token1Price.times(usdcWeight))
      .plus(usdtPair.token1Price.times(usdtWeight))
    // dai and USDC have been created
  } else if (busdPair !== null && usdcPair !== null) {
    let totalLiquidityETH = busdPair.reserve0.plus(usdcPair.reserve0)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    return busdPair.token1Price.times(busdWeight).plus(usdcPair.token1Price.times(usdcWeight))
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    return usdcPair.token1Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0x4cb6cef87d8cadf966b455e8bd58fff32aba49d1',
  '0x8a419ef4941355476cf04933e90bf3bbf2f73814',
  '0x3e5a2a4812d319ded22479a88ed708c6b55ca0b1',
  '0x1b80e7da342981314f4032434fe0def21b90ec20',
  '0xb0d0410d3d158a9b38c36e5aab80264bc5272a20',
  '0x4e5c590d2fa8aa3bc85342690ecfc33cf1c27ebb'

]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('2')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('2')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let stability = false;
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]),stability)
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }else{
       // let's check the other way round
       stability = true;
       pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]),stability)
       if (pairAddress.toHexString() != ADDRESS_ZERO) {
        let pair = Pair.load(pairAddress.toHexString())
        if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
          let token1 = Token.load(pair.token1)
          return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
        }
        if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
          let token0 = Token.load(pair.token0)
          return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
        }

    }
  }
 }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
