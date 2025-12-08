# Node faker
Emulate bitcoind and bitcoin-cli in the browser

# What is this?
This is a tool for emulating bitcoind by getting block data from electrum servers, with two demos in the form of a webapp and a desktop app.

# How can I try it?
Just click here and follow the instructions: https://supertestnet.github.io/node_faker

To use the API or the desktop version, see instructions further below.

# Why did you make this?
For two main reasons. One is that when working on some of my other projects I occasionally look for a way to interact with bitcoind programatically in the browser, but I find it hard to keep a node running; I run all my nodes on my laptop, which is usually turned off, so when I start them up, they have a lot of syncing to do, which makes me wait before doing whatever it is I wanted to do. This tool lets me emulate a fully synced node and test my apps against that, with confidence that my apps might not need much modification to work with "real" bitcoin nodes.

Also, I used to use a project called [spruned](https://github.com/gdassori/spruned), which I think means "super pruned." It tried to emulate bitcoind's json api, except instead of storing the blockchain on disk, it requested block data and transaction data on-the-fly from bitcoin nodes and electrum nodes. This allowed it to support software like lnd, cln, btc-rpc-explorer, and even bitcoin-cli, by simply "pretending" to be a bitcoin node. It was actually (mostly) just an electrum client, but software that *interacted* with it couldn't tell the difference, because it gave the same responses a real bitcoin node would. I think that's very cool, but it no longer seems to work for me, and I figured I could (mostly) recreate it in the browser. So I did.

# Instructions for using the api
The app has two dependencies, websockets and tapscript.js. Install tapscript.js and node_faker.js in your webapp like this:

```html
<script src="https://unpkg.com/@cmdcode/tapscript@latest"></script>
<script src="https://supertestnet.github.io/node_faker/node_faker.js"></script>
```

It is not necessary to install websockets in a webapp because all modern browsers have it built in. You can install websockets and tapscript in a nodejs app like this: `npm i ws @cmdcode/tapscript` -- but there is no similar one-liner for deploying node_faker.js in a nodejs app because I don't know how to package things for package managers. You can just copy/paste the full text of node_faker.js into your nodejs app, though.

Once you've got it all installed, the api is very easy:
```javascript
(async()=>{
    var result = await node_faker.processCommand( 'getblockhash 500000' );
    console.log( result );
})();
```
The `processCommand()` method accepts any of the supported commands listed below, in a similar format to how you might use them in a real instance of bitcoind.

**A note about status messages**  

Since this app is often slow to return results, users might get impatient waiting for a command to return. Status messages can help here; hence there is a helper tool at node_faker.status which gives status updates while your request is processing, and you might want to display those status updates to your users. But *one* method in this app -- `getblock` -- doesn't always post status messages correctly when it is processing lots of transactions, due to threading issues.

A workaround for this is to run the following command before you call `processCommand()`: `node_faker.waitWhenParsingTxs = true;` -- this makes it so that the `getblock` method occasionally waits a millisecond between processing some transactions, to let the status thread "catch up," which might be helpful if you are displaying status messages for your users. So consider running that command before you call the `processCommand()` method if displaying status messages for your users is a concern.

# Instructions for the desktop version
- Get nodejs
- Create a directory called something like "node_faker"
- Enter that directory and run `npm init -y`
- Install the dependencies: `npm i ws @cmdcode/tapscript`
- Download the index.js file and put it in your node_faker directory (or whatever you called it)
- Run the app with `node index.js`
- Voila! You can interact with it using the above-mentioned api, or using bitcoin-cli, or perhaps other apps that can talk to bitcoind -- if you're okay with the fact that a lot of bitcoind's commands don't work
- I also tested that LND can run on top of it. It's very slow. I did some napkin math to guess that it would probably take LND more than 3 days to do its initial blockscan, which I think is part of how it builds its channel graph. So it's a bad idea to run LND on top of this, but it would probably work, with some patience.

# General caveats
- This app is not fast as a full node because internet download is slower than a read from disk
- This app leaks privacy data, consider running it behind tor
- Errors returned by the implemented methods probably won't match errors returned by bitcoind, because they (mostly) come from electrum servers, not from bitcoind

Also, the app only supports some bitcoin-cli commands for now; namely, these ones:

=== Blockchain ===
- getbestblockhash
- getblock "blockhash" ( verbosity )
- getblockchaininfo
- getblockcount
- getblockhash height
- getblockheader "blockhash" ( verbose )
- gettxout "txid" n ( include_mempool )

=== Raw transactions ===
- getrawtransaction "txid" ( verbose )
- sendrawtransaction "hexstring"

=== Util ===
- estimatefee nblocks
- estimatesmartfee conf_target ( "estimate_mode" )
- uptime

=== Network ===
- getpeerinfo
- getnetworkinfo

=== Wallet ===
- validateaddress "address"

=== Partially emulated for compatibility ===
- getchaintxstats
- getindexinfo
- getmininginfo
- getnettotals
- getmempoolinfo
- getrawmempool
- getdeploymentinfo

# Command-specific caveats

For getblock, these additional caveats apply:

- chainwork is always a set of 32 empty bytes
- when the "verbose" option is set to 2 or more, all transactions in the block are represented in a format similar to bitcoind's, with the following exceptions:
- sometimes, for inputs, bitcoind provides a prevout object, though according to its documentation, it is "omitted if block undo data is not available." My format just always omits it; I'm not sure what block undo data is, but I'll just say that in my implementation, block undo data is never available (I suspect it is related to pruning), so that means I'm returning the same data you could expect from a version of bitcoind with no block undo data
- in scriptSigs, witnesses, and output scripts, bitcoind has an ASM format that I don't perfectly emulate; I use taprootjs's ASM format instead, after applying the "join" operator; this is pretty close to bitcoind's ASM format, but it's not identical
- in particular, for signatures that have a sigflag appended, bitcoind's format changes the sigflag from its hex value to a corresponding marker such as: `[ALL],` whereas taprootjs just keeps the hex value, e.g. `01`
- when displaying the value of a utxo, bitcoind uses a number format that allows for trailing zeroes; thus it might look like this: `"value": 0.21000000,` – whereas my format does not display trailing zeroes; e.g. my format would display that like this: `"value": 0.21,`
- in outputs, my format makes no attempt to replicate the descriptor, and for everything it says `"desc": "unknown",`
- four of the output types supported by bitcoind (i.e. pubkey, multisig, witness_unknown, and nonstandard) do not get their output type displayed properly in my format; instead I just say `"type": "unknown",` for those, and only support the seven most common ones, namely, pubkeyhash, scripthash, witness_v0_keyhash, witness_v0_scripthash, witness_v1_taproot, anchor, and nulldata
- the "difficulty" number does not match the difficulty number provided by bitcoind, and I don't know why

For getblockchaininfo, these additional caveats apply: chainwork is always a set of 32 empty bytes, size_on_disk is always 600 gigabytes, verificationprogress is always 1, initialblockdownload is always false, "pruned" is always false, "warnings" is always an array containing one value that just says node faker is emulating bitcoind and has incomplete data, and "chain" is always mainnet. Also, the "difficulty" number does not match the difficulty number provided by bitcoind, and I don't know why.

For getblockheader, these additional caveats apply: chainwork is always a set of 32 empty bytes, and the "difficulty" number does not match the difficulty number provided by bitcoind, and I don't know why.

For getrawtransaction, these additional caveats apply: if a blockhash is passed as a third parameter, it is always ignored, because it doesn't affect the output anyway (it's just meant to make bitcoind more efficient) and electrum servers don't seem to have an endpoint for passing that parameter to them anyway; also, prevout objects and txfee data are always omitted from the transaction and its inputs, even if verbosity is set higher than 1, because bitcoind omits them too whenever "block undo data" is not available, and as mentioned previously, I don't know what that is, but I can see I'm allowed to omit it (because bitcoind sometimes omits it) so I'm just always omitting it

For sendrawtransaction, these additional caveats apply: if the ( allowhighfees ) parameter is passed, it is ignored because electrum servers don't have an endpoint for passing this parameter

For estimatesmartfee, these additional caveats apply: passing "ECONOMICAL" as a second parameter ("estimate_mode") just adds 3 blocks to whatever conf_target you passed, rather than doing the complicated evaluations done by bitcoind; and if you pass a value for this parameter other than the word economical, it is ignored, because the only two other valid values I'm aware of are conservative, which is the default, and unset, which is treated the same as conservative

For getchaintxstats, these additional caveats apply: the two optional parameters ( nblocks and blockhash ) are ignored, as the parts of this function that I am currently interested in emulating are unaffected by them

For getindexinfo, these additional caveats apply: any parameters are ignored, as I only partially implemented this function to make my nodejs app work with Bitcoin RPC Explorer (and it still doesn't work yet anyway)

For getpeerinfo, these additional caveats apply: it always tries to randomly select 5 nodes from Peter Todd's DNS seed list and then pretends it's had a connection with each one for the last 2 hours (12 blocks); also, to get each peer's subversion, I look up the node on bitnodes.io, but they have CORS restrictions which break this in the browser, so I use a proxy called corsproxy.io; and they have rate limits in place which often make this function hang, and never return anything

For getnetworkinfo, these additional caveats apply: connections are always 5 and "warnings" is always an array containing one value that just says node faker is emulating bitcoind and has incomplete data

For getmempoolinfo, these additional caveats apply: the app always returns info about an empty mempool, just as if bitcoind is running in blocksonly mode

For getrawmempool, these additional caveats apply: the app always returns an empty array, just as if bitcoind is running in blocksonly mode

For getdeployment info, these additional caveats apply: any parameters are ignored, as I only partially implemented this function to make my nodejs app work with LND, and it was enough to mostly just return a json object saying the node supports taproot
