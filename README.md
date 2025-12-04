# Node faker
Emulate bitcoind and bitcoin-cli in the browser

# What is this?
This is a website that tries to emulate bitcoind in the browser by getting block data from electrum servers.

# How can I try it?
Just click here and follow the instructions: https://supertestnet.github.io/node_faker

# Why did you make this?
For two main reasons. One is that when working on some of my other projects I occasionally look for a way to interact with bitcoind programatically in the browser, but I find it hard to keep a node running. This tool will let me emulate one and test my apps against that, with confidence that it might not need much modification to work with a "real" bitcoin node.

Also, I used to use a project called [spruned](https://github.com/gdassori/spruned), which I think means "super pruned." It tried to emulate bitcoind's json api, except instead of storing the blockchain on disk, it requested block data and transaction data on-the-fly from bitcoin nodes and electrum nodes. This allowed it to support software like lnd, cln, btc-rpc-explorer, and even bitcoin-cli, by simply "pretending" to be a bitcoin node. It was actually (mostly) just an electrum client, but software that *interacted* with it couldn't tell the difference, because it gave the same responses a real bitcoin node would. I think that's very cool, but it no longer seems to work for me, and I figured I could (mostly) recreate it in the browser. So I did.

# Caveats
This app is not fast as a full node because internet download is slower than a read from disk  
This app leaks privacy data, consider running it behind tor  
For now, the app only supports some bitcoin-cli commands, namely, these ones:

- getbestblockhash
- getblock "blockhash" ( verbosity )
- getblockchaininfo
- getblockcount
- getblockhash height
- getblockheader "blockhash" ( verbose )
- getrawtransaction "txid" ( verbose )
- gettxout "txid" n ( include_mempool )

For getblock, these additional caveats apply:

- chainwork is always unknown
- when the "verbose" option is set to 2 or more, all transactions in the block are represented in a format similar to Core's, with the following exceptions:
- sometimes, for inputs, Core provides a prevout object, though according to its documentation, it is "omitted if block undo data is not available." My format just always omits it; I'm not sure what block undo data is, but I'll just say that in my implementation, block undo data is never available, so that means I'm returning the same data you could expect from a version of Core with no block undo data
- in scriptSigs, witnesses, and output scripts, Core has an ASM format that I don't perfectly emulate; I use taprootjs's ASM format instead, after applying the "join" operator; this is pretty close to Core's ASM format, but it's not identical
- in particular, for signatures that have a sigflag appended, Core's format changes the sigflag from its hex value to a corresponding marker such as: `[ALL],` whereas taprootjs just keeps the hex value, e.g. `01`
- when displaying the value of a utxo, Core uses a number format that allows for trailing zeroes; thus it might look like this: `"value": 0.21000000,` – whereas my format does not display trailing zeroes; e.g. my format would display that like this: `"value": 0.21,`
- in outputs, my format makes no attempt to replicate the descriptor, and for everything it says `"desc": "unknown",`
- four of the output types supported by Core (i.e. pubkey, multisig, witness_unknown, and nonstandard) do not get their output type displayed properly in my format; instead I just say `"type": "unknown",` for those, and only support the seven most common ones, namely, pubkeyhash, scripthash, witness_v0_keyhash, witness_v0_scripthash, witness_v1_taproot, anchor, and nulldata
- the "difficulty" number does not match the difficulty number provided by bitcoin core, and I don't know why

For getblockchaininfo, these additional caveats apply: chainwork is always unknown, size_on_disk is always unknown, verificationprogress is always 1, initialblockdownload is always false, "pruned" is always false, "warnings" is always an empty array, and "chain" is always mainnet. Also, the "difficulty" number does not match the difficulty number provided by bitcoin core, and I don't know why.

For getblockheader, these additional caveats apply: chainwork is always unknown, and the "difficulty" number does not match the difficulty number provided by bitcoin core, and I don't know why.

For getrawtransaction, these additional caveats apply: verbosity cannot be set to 2 or higher; if a blockhash is passed as a third parameter, it is always ignored; and prevout objects are always omitted from inputs because Core omits them too whenever "block undo data" is not available, and as mentioned previously, I don't know what that is, but I can see I'm allowed to omit it (because Core sometimes omits it) so I'm just always omitting it

# Next steps
- Allow setting verbosity to 2 or higher in getrawtransaction
- Implement sendrawtransaction ( allowhighfees )
- Implement estimatefee nblocks
- Implement estimatesmartfee conf_target ("estimate_mode")
- Implement uptime
- Implement getpeerinfo
- Implement getnetworkinfo
- Implement validateaddress
- Find out what parts of getchaintxstats spruned imlemented and implement those
- Find out what parts of getmininginfo spruned imlemented and implement those
- Find out what parts of getnettotals spruned imlemented and implement those
- Find out why spruned implemented optional support for getmempoolinfo, and if it is needed, try to do something similar to what they did
- Find out why spruned implemented optional support for getrawmempool, and if it is needed, try to do something similar to what they did
