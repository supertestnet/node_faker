var crypto = require( 'crypto' );
globalThis.crypto = crypto;
var tapscript = require( '@cmdcode/tapscript' );
var WebSocket = require( 'ws' );
var http = require( 'http' );
var url = require( 'url' );

var node_faker = {
    status: "",
    uptime: 0,
    waitWhenParsingTxs: false,
    getRand: num_of_bytes => node_faker.bytesToHex( crypto.getRandomValues( new Uint8Array( num_of_bytes ) ) ),
    waitSomeTime: num => new Promise( resolve => setTimeout( resolve, num ) ),
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    reverseHexString: s => s.match( /[a-fA-F0-9]{2}/g ).reverse().join( '' ),
    sha256: async s => {
        if ( typeof s == "string" ) s = new TextEncoder().encode( s );
        var arr = await crypto.subtle.digest( 'SHA-256', s );
        return node_faker.bytesToHex( new Uint8Array( arr ) );
    },
    parseHeader: header => {
        var block_info = {}
        var reverseHexString = s => s.match(/[a-fA-F0-9]{2}/g).reverse().join('');
        block_info.version = reverseHexString( header.substring( 0, 8 ) );
        header = header.substring( 8 );
        block_info.prevblock = reverseHexString( header.substring( 0, 64 ) );
        header = header.substring( 64 );
        block_info.merkle_root = reverseHexString( header.substring( 0, 64 ) );
        header = header.substring( 64 );
        block_info.timestamp_hex = reverseHexString( header.substring( 0, 8 ) );
        block_info.timestamp = parseInt( block_info.timestamp_hex, 16 );
        header = header.substring( 8 );
        block_info.difficulty = reverseHexString( header.substring( 0, 8 ) );
        header = header.substring( 8 );
        block_info.nonce = reverseHexString( header );
        return block_info;
    },
    connectToElectrumServer: async server => {
        console.log( `connecting to ${server}...` );
        var socket = new WebSocket( server );
        var isReady = async () => {
            if ( socket.readyState === 1 ) return;
            await node_faker.waitSomeTime( 10 );
            return isReady();
        }
        await isReady();
        console.log( `connected` );
        return socket;
    },
    queryElectrumServer: async ( socket, json ) => {
        if ( !json ) return 'you forgot to include a command';
        return new Promise( async resolve => {
            var handleFunction = async message => {
                resolve( message.data );
                socket.removeEventListener( 'message', handleFunction );
            }
            socket.addEventListener( 'message', handleFunction );
            socket.send( JSON.stringify( json ) );
        });
    },
    queryEsploraServer: async ( server, endpoint ) => {
        if ( !server || !endpoint ) return 'you forgot to include a server or an endpoint';
        var data = await fetch( `${server}${endpoint}` );
        if ( endpoint.includes( "/block/" ) && endpoint.includes( "/raw" ) ) {
            var blob = await data.blob();
            var block = await node_faker.blobToHex( blob );
            return block;
        }
        if ( endpoint.includes( "/block/" ) && endpoint.includes( "/header" ) ) {
            var header = await data.text();
            return header;
        }
        var json = await data.json();
        return json;
    },
    getMTP: async ( socket, blockheight, first_timestamp ) => {
        if ( blockheight < 12 ) return first_timestamp;
        var last_eleven_blocks = [];
        var blockheight_minus_one = blockheight - 1;
        var last_eleven_timestamps = [first_timestamp];
        var i; for ( i=blockheight_minus_one; i>blockheight_minus_one-10;i--) last_eleven_blocks.push( i );
        var i; for ( i=0; i<last_eleven_blocks.length; i++ ) {
            var formatted_command = {
                "id": node_faker.getRand( 8 ),
                "method": "blockchain.block.header",
                "params": [ last_eleven_blocks[ i ] ],
            }
            var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
            response_from_server = JSON.parse( response_from_server );
            var temp_parsed_header = node_faker.parseHeader( response_from_server.result );
            last_eleven_timestamps.push( temp_parsed_header.timestamp );
        }
        last_eleven_timestamps.sort();
        return last_eleven_timestamps[ 5 ];
    },
    decodeCompactSize: compact_size => {
        var reverseHexString = node_faker.reverseHexString;
        var first_byte = compact_size.substring( 0, 2 ).toLowerCase();
        var size = Number( BigInt( `0x${reverseHexString( compact_size.substring( 0, 2 ) )}` ) );
        var actual_compact_size = compact_size.substring( 0, 2 );
        if ( first_byte === "fd" ) {
            var rest = compact_size.substring( 2, 2 + 4 ).toLowerCase();
            var size = Number( BigInt( `0x${reverseHexString( rest )}` ) );
            var actual_compact_size = compact_size.substring( 0, 6 );
        }
        if ( first_byte === "fe" ) {
            var rest = compact_size.substring( 2, 2 + 8 ).toLowerCase();
            var size = Number( BigInt( `0x${reverseHexString( rest )}` ) );
            var actual_compact_size = compact_size.substring( 0, 10 );
        }
        if ( first_byte === "ff" ) {
            var rest = compact_size.substring( 2 ).toLowerCase();
            var size = Number( BigInt( `0x${reverseHexString( rest )}` ) );
            var actual_compact_size = compact_size;
        }
        return { size, first_byte, actual_compact_size }
    },
    parseTransactions: ( num_of_txs, txs ) => {
        var decodeCompactSize = node_faker.decodeCompactSize;
        var rest = txs;
        var tx_objects = [];
        var loop = rest => {
            var tx = {}
            tx[ "hex" ] = ``;
            tx[ "version" ] = rest.substring( 0, 8 );
            tx[ "hex" ] += rest.substring( 0, 8 );
            var rest = rest.substring( 8 );
            var is_segwit = rest.substring( 0, 4 ) === "0001";
            if ( is_segwit ) {
                tx[ "segwit_flag" ] = rest.substring( 0, 4 );
                tx[ "is_segwit" ] = true;
                tx[ "hex" ] += rest.substring( 0, 4 );
                rest = rest.substring( 4 );
            }
            var compact_size = rest.substring( 0, 18 );
            var { size, first_byte, actual_compact_size } = decodeCompactSize( compact_size );
            tx[ "number_of_inputs" ] = [ size , actual_compact_size ];
            tx[ "hex" ] += rest.substring( 0, 2 );
            rest = rest.substring( 2 );
            if ( first_byte === "fd" ) tx[ "hex" ] += rest.substring( 0, 4 );
            if ( first_byte === "fd" ) rest = rest.toString( "hex" ).substring( 4 );
            if ( first_byte === "fe" ) tx[ "hex" ] += rest.substring( 0, 8 );
            if ( first_byte === "fe" ) rest = rest.substring( 8 );
            if ( first_byte === "ff" ) tx[ "hex" ] += rest.substring( 0, 16 );
            if ( first_byte === "ff" ) rest = rest.substring( 16 );
            var num_of_inputs = size;
            var i; for ( i=0; i<num_of_inputs; i++ ) {
                tx[ `input_${i}` ] = {txid: rest.substring( 0, 64 ), vout: rest.substring( 64, 64 + 8 )}
                tx[ "hex" ] += rest.substring( 0, 64 + 8 );
                rest = rest.substring( 64 + 8 );
                var compact_size = rest.substring( 0, 18 );
                var { size, first_byte, actual_compact_size } = decodeCompactSize( compact_size );
                tx[ `input_${i}` ][ "length_of_scriptsig" ] = [ size, actual_compact_size ];
                tx[ "hex" ] += rest.substring( 0, 2 );
                rest = rest.substring( 2 );
                if ( first_byte === "fd" ) tx[ "hex" ] += rest.substring( 0, 4 );
                if ( first_byte === "fd" ) rest = rest.toString( "hex" ).substring( 4 );
                if ( first_byte === "fe" ) tx[ "hex" ] += rest.substring( 0, 8 );
                if ( first_byte === "fe" ) rest = rest.substring( 8 );
                if ( first_byte === "ff" ) tx[ "hex" ] += rest.substring( 0, 16 );
                if ( first_byte === "ff" ) rest = rest.substring( 16 );
                tx[ `input_${i}` ][ "scriptsig" ] = rest.substring( 0, tx[ `input_${i}` ][ "length_of_scriptsig" ][ 0 ] * 2 );
                tx[ "hex" ] += rest.substring( 0, tx[ `input_${i}` ][ "length_of_scriptsig" ][ 0 ] * 2 );
                rest = rest.substring( tx[ `input_${i}` ][ "length_of_scriptsig" ][ 0 ] * 2 );
                tx[ `input_${i}` ][ "sequence" ] = rest.substring( 0, 8 );
                tx[ "hex" ] += rest.substring( 0, 8 );
                rest = rest.substring( 8 );
            }
            var compact_size = rest.substring( 0, 18 );
            var { size, first_byte, actual_compact_size } = decodeCompactSize( compact_size );
            tx[ `num_of_outputs` ] = [ size, actual_compact_size ];
            tx[ "hex" ] += rest.substring( 0, 2 );
            rest = rest.substring( 2 );
            if ( first_byte === "fd" ) tx[ "hex" ] += rest.substring( 0, 4 );
            if ( first_byte === "fd" ) rest = rest.toString( "hex" ).substring( 4 );
            if ( first_byte === "fe" ) tx[ "hex" ] += rest.substring( 0, 8 );
            if ( first_byte === "fe" ) rest = rest.substring( 8 );
            if ( first_byte === "ff" ) tx[ "hex" ] += rest.substring( 0, 16 );
            if ( first_byte === "ff" ) rest = rest.substring( 16 );
            var num_of_outputs = size;
            var i; for ( i=0; i<num_of_outputs; i++ ) {
                tx[ `output_${i}` ] = {value: rest.substring( 0, 16 )}
                tx[ "hex" ] += rest.substring( 0, 16 );
                rest = rest.substring( 16 );
                var compact_size = rest.substring( 0, 18 );
                var { size, first_byte, actual_compact_size } = decodeCompactSize( compact_size );
                tx[ `output_${i}` ][ "length_of_scriptPubKey" ] = [ size, actual_compact_size ];
                tx[ "hex" ] += rest.substring( 0, 2 );
                rest = rest.substring( 2 );
                if ( first_byte === "fd" ) tx[ "hex" ] += rest.substring( 0, 4 );
                if ( first_byte === "fd" ) rest = rest.toString( "hex" ).substring( 4 );
                if ( first_byte === "fe" ) tx[ "hex" ] += rest.substring( 0, 8 );
                if ( first_byte === "fe" ) rest = rest.substring( 8 );
                if ( first_byte === "ff" ) tx[ "hex" ] += rest.substring( 0, 16 );
                if ( first_byte === "ff" ) rest = rest.substring( 16 );
                tx[ `output_${i}` ][ "scriptPubKey" ] = scriptPubKey = rest.substring( 0, size * 2 );    
                tx[ "hex" ] += rest.substring( 0, size * 2 );
                rest = rest.substring( size * 2 );
            }
            if ( is_segwit ) {
                var i; for ( i=0; i<num_of_inputs; i++ ) {
                    var compact_size = rest.substring( 0, 18 );
                    var { size, first_byte, actual_compact_size } = decodeCompactSize( compact_size );
                    tx[ `input_${i}` ][ "num_of_elements_in_witness" ] = [ size, actual_compact_size ];
                    tx[ `input_${i}` ][ "sizes_of_each_witness_element" ] = [];
                    tx[ `input_${i}` ][ "witness" ] = [];
                    tx[ "hex" ] += rest.substring( 0, 2 );
                    rest = rest.substring( 2 );
                    if ( first_byte === "fd" ) tx[ "hex" ] += rest.substring( 0, 4 );
                    if ( first_byte === "fd" ) rest = rest.toString( "hex" ).substring( 4 );
                    if ( first_byte === "fe" ) tx[ "hex" ] += rest.substring( 0, 8 );
                    if ( first_byte === "fe" ) rest = rest.substring( 8 );
                    if ( first_byte === "ff" ) tx[ "hex" ] += rest.substring( 0, 16 );
                    if ( first_byte === "ff" ) rest = rest.substring( 16 );
                    var num_of_elements = size;
                    var j; for ( j=0; j<num_of_elements; j++ ) {
                        var compact_size = rest.substring( 0, 18 );
                        var { size, first_byte, actual_compact_size } = decodeCompactSize( compact_size );
                        tx[ `input_${i}` ][ "sizes_of_each_witness_element" ].push( [ size, actual_compact_size ] );
                        tx[ "hex" ] += rest.substring( 0, 2 );
                        rest = rest.substring( 2 );
                        if ( first_byte === "fd" ) tx[ "hex" ] += rest.substring( 0, 4 );
                        if ( first_byte === "fd" ) rest = rest.toString( "hex" ).substring( 4 );
                        if ( first_byte === "fe" ) tx[ "hex" ] += rest.substring( 0, 8 );
                        if ( first_byte === "fe" ) rest = rest.substring( 8 );
                        if ( first_byte === "ff" ) tx[ "hex" ] += rest.substring( 0, 16 );
                        if ( first_byte === "ff" ) rest = rest.substring( 16 );
                        tx[ `input_${i}` ][ "witness" ].push( rest.substring( 0, size * 2 ) );
                        tx[ "hex" ] += rest.substring( 0, size * 2 );
                        rest = rest.substring( size * 2 );
                    }
                }
            }
            tx[ `locktime` ] = rest.substring( 0, 8 );
            tx[ "hex" ] += rest.substring( 0, 8 );
            rest = rest.substring( 8 );
            return [ tx, rest ];
        }
        var i; for ( i=0; i<num_of_txs; i++ ) {
            var [ tx, rest ] = loop( rest );
            tx_objects.push( tx );
        }
        return tx_objects;
    },
    getTransactionsFromBlock: block => {
        var { size, first_byte, actual_compact_size } = node_faker.decodeCompactSize( block.substring( 160, 160 + 18 ) );
        var txs = block.substring( 160 + 2 );
        if ( first_byte === "fd" ) txs = txs.substring( 4 );
        if ( first_byte === "fe" ) txs = txs.substring( 8 );
        if ( first_byte === "ff" ) txs = txs.substring( 16 );
        var tx_objects = node_faker.parseTransactions( size, txs );
        return tx_objects;
    },
    blobToHex: async blob => {
        var buf = await blob.arrayBuffer();
        var arr = new Uint8Array( buf );
        return node_faker.bytesToHex( arr )
    },
    processCommand: async command => {
        try {
            var command_arr = command.split( " " );
            if ( command_arr[ 0 ] === "bitcoin-cli" ) command_arr.splice( 0, 1 );
            var command = command_arr[ 0 ];
            if ( !command ) {
                node_faker.status = "";
                return "unknown error";
            }
            if ( command === "getblockchaininfo" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get the header
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                // var response_from_server = {result: { height: 926182, hex: "00e0c420db0805c816f368b5036a2bbda38184bb28e35331b600010000000000000000006796898b301c511dd441870f9084896c4ff1b556ba886035ae5890f6c3ed086154492f69a0e201176d1d04e5" } }

                //extract info from the header
                var header = response_from_server.result.hex;
                var parsed_header = node_faker.parseHeader( header );
                var blockheight = response_from_server.result.height;
                var median_timestamp = await node_faker.getMTP( socket, blockheight, parsed_header.timestamp );
                var midhash = await node_faker.sha256( node_faker.hexToBytes( header ) );
                var revhash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
                var blockhash = node_faker.reverseHexString( revhash );
                var nbits = parsed_header.difficulty;
                var exponent = parseInt( nbits.substring( 0, 2 ), 16 );
                var exponent_minus_three = exponent - 3;
                var exponent_as_length = ( exponent_minus_three * 2 );
                var current_target = nbits.substring( 2 ).padEnd( exponent_as_length, "0" ).padStart( 64, "0" );
                var max_difficulty = "00000000FFFF0000000000000000000000000000000000000000000000000000";
                var difficulty = Number( BigInt( `0x${max_difficulty}` ) / BigInt( `0x${current_target}` ) );

                //return the results
                node_faker.status = "";
                return {
                    "chain": "mainnet",
                    "blocks": blockheight,
                    "headers": blockheight,
                    "bestblockhash": blockhash,
                    "bits": nbits,
                    "target": current_target,
                    "difficulty": difficulty,
                    "time": parsed_header.timestamp,
                    "mediantime": median_timestamp,
                    "verificationprogress": 1,
                    "initialblockdownload": false,
                    "chainwork": "0".repeat( 64 ),
                    "size_on_disk": "unknown",
                    "pruned": false,
                    "warnings": [ "node faker, emulating bitcoind, incomplete data" ],
                }
            }
            if ( command === "getblock" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );
                var blockhash = command_arr[ 1 ];
                blockhash = blockhash.replaceAll( '"', "" ).replaceAll( "'", "" );
                var endpoint = `/block/${blockhash}/raw`;
                node_faker.status = "downloading block...";
                var block = await node_faker.queryEsploraServer( esplora_server, endpoint );

                //return the block if the verbose param is 0
                if ( command_arr[ 2 ] && command_arr[ 2 ] === "0" ) {
                    node_faker.status = "";
                    return block;
                }

                //get the height of this block so we can query electrum servers about it and populate our result with info about its height
                var endpoint = `/block/${blockhash}/status`;
                node_faker.status = "getting blockheight of this block...";
                var data = await node_faker.queryEsploraServer( esplora_server, endpoint );
                var height_of_this_block = data.height;

                //get info about the current blockheight, and calculate the number of confs the relevant block has
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                node_faker.status = "getting blockheight of entire blockchain...";
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                var blockheight = response_from_server.result.height;
                var confirmations = ( blockheight - height_of_this_block ) + 1;

                // //get header info about the relevant block
                // var formatted_command = {
                //     "id": node_faker.getRand( 8 ),
                //     "method": "blockchain.block.header",
                //     "params": [ height_of_this_block ],
                // }
                // var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                // response_from_server = JSON.parse( response_from_server );
                // var parsed_header = node_faker.parseHeader( response_from_server.result );

                //parse the header
                var header = block.substring( 0, 160 );
                var parsed_header = node_faker.parseHeader( header );

                //extract info from the relevant block
                node_faker.status = "getting median timestamp...";
                var median_timestamp = await node_faker.getMTP( socket, height_of_this_block, parsed_header.timestamp );
                var nbits = parsed_header.difficulty;
                var exponent = parseInt( nbits.substring( 0, 2 ), 16 );
                var exponent_minus_three = exponent - 3;
                var exponent_as_length = ( exponent_minus_three * 2 );
                var current_target = nbits.substring( 2 ).padEnd( exponent_as_length, "0" ).padStart( 64, "0" );
                var max_difficulty = "00000000FFFF0000000000000000000000000000000000000000000000000000";
                var difficulty = Number( BigInt( `0x${max_difficulty}` ) / BigInt( `0x${current_target}` ) );

                //get the block so we can get info about its transactions
                var txs = node_faker.getTransactionsFromBlock( block );

                //extract info from the transactions
                var total_bsize = 0;
                var total_vsize = 0;
                var total_weight = 0;
                var txids = [];
                var i; for ( i=0; i<txs.length; i++ ) {
                    if ( String( i ).endsWith( "00" ) ) {
                        node_faker.status = `parsing tx ${i} out of ${txs.length}...`;
                        //I sometimes wait 1 millisecond so that the status displayer can "catch up" and display my current status
                        if ( node_faker.waitWhenParsingTxs ) await node_faker.waitSomeTime( 1 );
                    }
                    var tx = txs[ i ];
                    var sizes = tapscript.Tx.util.getTxSize( tx.hex );
                    var total_bsize = total_bsize + sizes.bsize;
                    var total_vsize = total_vsize + sizes.vsize;
                    var total_weight = total_weight + sizes.weight;
                    if ( !command_arr[ 2 ] || ( command_arr[ 2 ] && Number( command_arr[ 2 ] ) === 1 ) ) txids.push( tapscript.Tx.util.getTxid( tx.hex ) );
                    else if ( command_arr[ 2 ] && Number( command_arr[ 2 ] ) > 1 ) {
                        var include_txhex = true;
                        var tx_obj = await node_faker.convertTxhexToCoreFormat( tx.hex, include_txhex );
                        txids.push( tx_obj );
                    }
                }
                var loop = async () => {
                    if ( txids.length === txs.length ) return;
                    await node_faker.waitSomeTime( 10 );
                    return loop();
                }
                await loop();

                //return the results
                node_faker.status = "";
                return {
                    "hash": blockhash,
                    "confirmations": confirmations,
                    "height": height_of_this_block,
                    "version": parseInt( parsed_header.version, 16 ),
                    "versionHex": parsed_header.version,
                    "merkleroot": parsed_header.merkleroot,
                    "time": parsed_header.timestamp,
                    "mediantime": median_timestamp,
                    "nonce": parseInt( parsed_header.nonce, 16 ),
                    "bits": nbits,
                    "target": current_target,
                    "difficulty": difficulty,
                    "chainwork": "0".repeat( 64 ),
                    "nTx": txs.length,
                    "previousblockhash": parsed_header.prevblock,
                    "strippedsize": total_bsize,
                    "size": total_vsize,
                    "weight": total_weight,
                    "tx": txids,
                }
            }
            if ( command === "getbestblockhash" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get the header
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );

                //return the header's hash
                var header = response_from_server.result.hex;
                var midhash = await node_faker.sha256( node_faker.hexToBytes( header ) );
                var revhash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
                var blockhash = node_faker.reverseHexString( revhash );
                node_faker.status = "";
                return blockhash;
            }
            if ( command === "getblockcount" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get the header
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );

                //return the header's height
                node_faker.status = "";
                return response_from_server.result.height;
            }
            if ( command === "getblockhash" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );
                var height = Number( command_arr[ 1 ] );

                //get header info about the relevant block
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.block.header",
                    "params": [ height ],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );

                //return the header's hash
                var header = response_from_server.result;
                var midhash = await node_faker.sha256( node_faker.hexToBytes( header ) );
                var revhash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
                var blockhash = node_faker.reverseHexString( revhash );
                node_faker.status = "";
                return blockhash;
            }
            if ( command === "getblockheader" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                var blockhash = command_arr[ 1 ];
                blockhash = blockhash.replaceAll( '"', "" ).replaceAll( "'", "" );
                var endpoint = `/block/${blockhash}/raw`;
                node_faker.status = "downloading block...";
                var block = await node_faker.queryEsploraServer( esplora_server, endpoint );
                var verbosity = Number( command_arr[ 2 ] );
                var header = block.substring( 0, 160 );
                // var endpoint = `/block/${blockhash}/header`;
                // var header = await node_faker.queryEsploraServer( esplora_server, endpoint );
                if ( typeof verbosity === "number" && verbosity === 0 ) {
                    node_faker.status = "";
                    return header;
                }

                //get the height of this block so we can query electrum servers about it and populate our result with info about its height
                var midhash = await node_faker.sha256( node_faker.hexToBytes( header ) );
                var revhash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
                var blockhash = node_faker.reverseHexString( revhash );
                var endpoint = `/block/${blockhash}/status`;
                node_faker.status = "getting blockheight...";
                var data = await node_faker.queryEsploraServer( esplora_server, endpoint );
                var height_of_this_block = data.height;

                //get info about the current blockheight, and calculate the number of confs the relevant block has
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                node_faker.status = "getting current blockheight...";
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                var blockheight = response_from_server.result.height;
                var confirmations = ( blockheight - height_of_this_block ) + 1;

                //get info about the next blockhash, if any
                var next_blockhash = undefined;
                try {
                    if ( confirmations === 1 ) throw( 'no next block query needed' );
                    var formatted_command = {
                        "id": node_faker.getRand( 8 ),
                        "method": "blockchain.block.header",
                        "params": [ height_of_this_block + 1 ],
                    }
                    node_faker.status = "checking for next block...";
                    var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                    response_from_server = JSON.parse( response_from_server );
                    var next_header = response_from_server.result;
                    var midhash = await node_faker.sha256( node_faker.hexToBytes( next_header ) );
                    var revhash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
                    next_blockhash = node_faker.reverseHexString( revhash );
                } catch ( e ) {}

                //extract data about the header
                var parsed_header = node_faker.parseHeader( header );
                node_faker.status = "getting median timestamp...";
                var median_timestamp = await node_faker.getMTP( socket, height_of_this_block, parsed_header.timestamp );
                var nbits = parsed_header.difficulty;
                var exponent = parseInt( nbits.substring( 0, 2 ), 16 );
                var exponent_minus_three = exponent - 3;
                var exponent_as_length = ( exponent_minus_three * 2 );
                var current_target = nbits.substring( 2 ).padEnd( exponent_as_length, "0" ).padStart( 64, "0" );
                var max_difficulty = "00000000FFFF0000000000000000000000000000000000000000000000000000";
                var difficulty = Number( BigInt( `0x${max_difficulty}` ) / BigInt( `0x${current_target}` ) );

                //get the block so we can get info about its transactions
                //get the number of transactions from the block
                var possible_csize = block.substring( 160, 160 + 18 );
                var num_of_txs = node_faker.decodeCompactSize( possible_csize ).size

                //return the requested data
                node_faker.status = "";
                return {
                    "hash": blockhash,
                    "confirmations": confirmations,
                    "height": height_of_this_block,
                    "version": parseInt( parsed_header.version, 16 ),
                    "versionHex": parsed_header.version,
                    "merkleroot": parsed_header.merkleroot,
                    "time": parsed_header.timestamp,
                    "mediantime": median_timestamp,
                    "nonce": parseInt( parsed_header.nonce, 16 ),
                    "bits": nbits,
                    "target": current_target,
                    "difficulty": difficulty,
                    "chainwork": "0".repeat( 64 ),
                    "nTx": num_of_txs,
                    "previousblockhash": parsed_header.prevblock,
                    "nextblockhash": next_blockhash,
                }
            }
            if ( command === "gettxout" ) {
                var txhash = command_arr[ 1 ];
                txhash = txhash.replaceAll( '"', "" ).replaceAll( "'", "" );
                var vout = command_arr[ 2 ];
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get the txhex
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.transaction.get",
                    "params": [ txhash, true ],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                var txdata = response_from_server.result;
                var confirmations = txdata.confirmations || 0;

                //get the best block header
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );

                //get the header hash
                var header = response_from_server.result.hex;
                var midhash = await node_faker.sha256( node_faker.hexToBytes( header ) );
                var revhash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
                var bestblock = node_faker.reverseHexString( revhash );

                //return the requested data
                node_faker.status = "";
                if ( command_arr[ 3 ] === "false" && !confirmations ) {
                    node_faker.status = "";
                    return "null";
                }
                return {
                    "bestblock": bestblock,
                    "confirmations": confirmations,
                    "value": txdata.vout[ vout ].value,
                    "scriptPubKey": txdata.vout[ vout ].scriptPubKey,
                    "coinbase": txdata.vin[ 0 ].hasOwnProperty( "coinbase" ),
                }
            }
            if ( command === "getrawtransaction" ) {
                var txhash = command_arr[ 1 ];
                txhash = txhash.replaceAll( '"', "" ).replaceAll( "'", "" );
                var verbosity = Number( command_arr[ 2 ] );
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get the txhex
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.transaction.get",
                    "params": [ txhash, true ],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                if ( response_from_server.hasOwnProperty( "error" ) && response_from_server.error.hasOwnProperty( "message" ) && response_from_server.error.message ) {
                    node_faker.status = "";
                    return response_from_server.error.message;
                }
                var txhex = response_from_server.result.hex;

                //return the txhex if verbosity is set to 0
                if ( !verbosity ) {
                    node_faker.status = "";
                    return txhex;
                }

                //return the whole response from the server if verbosity is higher than 1
                //note that I used to throw an error if verbosity was higher than 1, because that's *supposed to* add prevout data for each input and the txfee paid by the tx (obtained by subtracting the value of the outputs from the value of the inputs), and I hadn't implemented that yet; but after looking at bitcoin core's documentation, I discovered that even if verbsosity *is* set higher than 1, Core still omits that unless "block undo data" is available, which I think means, it only displays that data if it can recover the blocks where the input utxos were created. Since Core sometimes omits this data, even when verbosity is set higher than 1, I think it is safe to omit it too, so that's what I'm doing.
                node_faker.status = "";
                return response_from_server.result;
            }
            if ( command === "sendrawtransaction" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );
                var txhex = command_arr[ 1 ];
                txhex = txhex.replaceAll( '"', "" ).replaceAll( "'", "" );

                //get header info about the relevant block
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.transaction.broadcast",
                    "params": [ txhex ],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                if ( response_from_server.hasOwnProperty( "error" ) && response_from_server.error.hasOwnProperty( "message" ) && response_from_server.error.message ) {
                    node_faker.status = "";
                    return response_from_server.error.message;
                }
                node_faker.status = "";
                return response_from_server.result;
            }
            if ( command === "estimatefee" ) {
                var nblocks = Number( command_arr[ 1 ] );
                if ( !nblocks ) {
                    node_faker.status = "";
                    return 'invalid number of arguments';
                }
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get header info about the relevant block
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.estimatefee",
                    "params": [ nblocks ],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                if ( response_from_server.hasOwnProperty( "error" ) && response_from_server.error.hasOwnProperty( "message" ) && response_from_server.error.message ) {
                    node_faker.status = "";
                    return response_from_server.error.message;
                }
                node_faker.status = "";
                return response_from_server.result;
            }
            if ( command === "estimatesmartfee" ) {
                var nblocks = Number( command_arr[ 1 ] );
                if ( !nblocks ) {
                    node_faker.status = "";
                    return 'invalid number of arguments';
                }
                var num_for_query = nblocks;
                var economical = command_arr[ 2 ] || "";
                economical = economical.toLowerCase().replaceAll( '"', "" ).replaceAll( "'", "" );
                if ( economical === "economical" ) num_for_query = num_for_query + 3;

                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get header info about the relevant block
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.estimatefee",
                    "params": [ nblocks ],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                if ( response_from_server.hasOwnProperty( "error" ) && response_from_server.error.hasOwnProperty( "message" ) && response_from_server.error.message ) {
                    node_faker.status = "";
                    return response_from_server.error.message;
                }
                node_faker.status = "";
                return {
                    "feerate": response_from_server.result,
                    "blocks": nblocks,
                }
            }
            if ( command === "uptime" ) {
                node_faker.status = "";
                return node_faker.uptime;
            }
            if ( command === "getpeerinfo" ) {
                //get list of peers
                node_faker.status = "getting list of peers...";
                var peers_data = await fetch( 'https://dns.google/resolve?name=seed.btc.petertodd.org&type=A' );
                var peers_json = await peers_data.json();

                //prepare function to test them
                var tryRandomPeer = async ( source, peers_tried = [] ) => {
                    var loop = () => {
                        var rand = Math.floor( Math.random() * source.length );
                        if ( peers_tried.includes( rand ) ) return loop();
                        return rand;
                    }
                    var peer_to_try = loop();
                    peers_tried.push( peer_to_try );
                    try {
                        var ip = peers_json.Answer[ peer_to_try ].data;
                        var port = ip.includes( ":" ) ? Number( ip.substring( 0, ip.indexOf( ":" ) + 1 ) ) : 8333;
                        var checkPeer = async ( ip, port ) => {
                            return new Promise( async resolve => {
                                var peer_data = await fetch("https://corsproxy.io/?https://bitnodes.io/api/v1/checknode/", {
                                    "headers": {
                                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                                    },
                                    "referrer": "https://google.com",
                                    "body": `address=${ip}&port=${port}`,
                                    "method": "POST",
                                    "mode": "cors",
                                });
                                var peer_json = await peer_data.json();
                                if ( peer_json.hasOwnProperty( "user_agent" ) ) resolve( peer_json[ "user_agent" ] );
                            });
                        }
                        var peer_is_good = await checkPeer( ip, port );
                        if ( peer_is_good ) return [ 'peer_is_good', peer_to_try, `${ip}:${port}`, peer_is_good ];
                        return peers_tried;
                    } catch ( e ) {
                        return peers_tried;
                    }
                }

                //find 5 good peers
                var good_peers = [];
                var peers_tried = [];
                var loop = async () => {
                    node_faker.status = `found peer ${good_peers.length} out of 5...`;
                    var peer = await tryRandomPeer( peers_json.Answer, peers_tried );
                    if ( peer[ 0 ] === 'peer_is_good' ) {
                        good_peers.push( peer );
                        peers_tried.push( peer[ 1 ] );
                    }
                    else peers_tried = peer;
                    if ( good_peers.length < 5 ) return loop();
                }
                await loop();

                //get the header
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );
                node_faker.status = `getting current blockheight...`;
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                var blockheight = response_from_server.result.height;

                //list your peers
                var peers = [];
                var current_block = blockheight;
                good_peers.forEach( peer => peers.push({
                    "addr": peer[ 2 ],
                    "subver": peer[ 3 ],
                    "conntime": Math.floor( Date.now() / 1000 ) - Math.floor( Math.random() * 7200 ),
                    "startingheight": blockheight - 12,
                }) );

                node_faker.status = "";
                return peers;
            }
            if ( command === "getnetworkinfo" ) {
                node_faker.status = "";
                return {
                    "version": 150100,
                    "subversion": "/node faker/",
                    "protocolversion": 70015,
                    "localservices": "000000000000000d",
                    "localrelay": false,
                    "timeoffset": 0,
                    "networkactive": false,
                    "connections": 0,
                    "networks": [
                        {
                            "name": "ipv4",
                            "limited": true,
                            "reachable": false,
                            "proxy": "",
                            "proxy_randomize_credentials": false
                        },
                        {
                            "name": "ipv6",
                            "limited": false,
                            "reachable": false,
                            "proxy": "",
                            "proxy_randomize_credentials": false
                        },
                        {
                            "name": "onion",
                            "limited": true,
                            "reachable": false,
                            "proxy": "",
                            "proxy_randomize_credentials": false
                        }
                    ],
                    "relayfee": 0,
                    "incrementalfee": 0,
                    "localaddresses": [
                        {
                            "address": "127.0.0.1",
                            "port": 8332,
                            "score": 29
                        },
                    ],
                    "warnings": [ "node faker, emulating bitcoind, incomplete data" ],
                }
            }
            if ( command === "validateaddress" ) {
                var address = command_arr[ 1 ];
                address = address.replaceAll( '"', "" ).replaceAll( "'", "" );
                var is_valid = node_faker.isValidAddress( address );
                if ( !is_valid ) {
                    node_faker.status = "";
                    return {
                        "isvalid": false,
                        "error_locations": [
                        ],
                        "error": "Invalid checksum or length of Base58 address (P2PKH or P2SH)"
                    }
                }

                node_faker.status = "";
                if ( address !== "bc1pfeessrawgf" ) {
                    var scriptPubKey = tapscript.Script.encode( tapscript.Address.toScriptPubKey( address ) ).hex.substring( 2 );
                    var isscript = address.startsWith( "3" ) || ( address.startsWith( "bc1q" ) && scriptPubKey.length === 68 );
                    var iswitness = scriptPubKey.startsWith( "00" ) || scriptPubKey.startsWith( "51" );
                    var witness_version = undefined;
                    if ( iswitness ) witness_version = scriptPubKey.startsWith( "00" ) ? 0 : 1;
                    var witness_program = undefined;
                    if ( iswitness ) witness_program = scriptPubKey.substring( 4 );
                } else {
                    var scriptPubKey = "51024e73";
                    var isscript = false;
                    var iswitness = true;
                    var witness_version = 1;
                    var witness_program = "024e73";
                }
                return {
                    "isvalid": true,
                    "address": address,
                    "scriptPubKey": scriptPubKey,
                    "isscript": isscript,
                    "iswitness": iswitness,
                    "witness_version": witness_version,
                    "witness_program": witness_program,
                }
            }
            if ( command === "getchaintxstats" ) {
                node_faker.status = "";
                return {
                    "time": Math.floor( Date.now() / 1000 ),
                    "txcount": 0,
                    "window_block_count": 0,
                    "window_tx_count": 0,
                    "window_interval": 0,
                    "txrate": 0,
                    "errors": "node faker, emulating bitcoind, incomplete data"
                }
            }
            if ( command === "getmininginfo" ) {
                if ( !socket || socket.readyState === 3 ) socket = await node_faker.connectToElectrumServer( electrum_server );

                //get the header
                var formatted_command = {
                    "id": node_faker.getRand( 8 ),
                    "method": "blockchain.headers.subscribe",
                    "params": [],
                }
                var response_from_server = await node_faker.queryElectrumServer( socket, formatted_command );
                response_from_server = JSON.parse( response_from_server );
                var blockheight = response_from_server.result.height;

                node_faker.status = "";
                return {
                    "blocks": blockheight,
                    "chain": "mainnet",
                    "currentblocktx": 0,
                    "currentblockweight": 0,
                    "difficulty": 0,
                    "networkhashps": 0,
                    "pooledtx": 0,
                    "errors": "node faker, emulating bitcoind, incomplete data"
                }
            }
            if ( command === "getnettotals" ) {
                node_faker.status = "";
                return {
                    "totalbytesrecv": 0,
                    "totalbytessent": 0,
                    "timemillis": Date.now(),
                    "uploadtarget": {
                        "timeframe": 86400,
                        "target": 0,
                        "target_reached": false,
                        "serve_historical_blocks": false,
                        "bytes_left_in_cycle": 0,
                        "time_left_in_cycle": 0
                    }
                }
            }
            if ( command === "getmempoolinfo" ) {
                node_faker.status = "";
                return {
                    "loaded": true,
                    "size": 0,
                    "bytes": 0,
                    "usage": 0,
                    "total_fee": 0.00000000,
                    "maxmempool": 5000000,
                    "mempoolminfee": 0.00001000,
                    "minrelaytxfee": 0.00001000,
                    "incrementalrelayfee": 0.00001000,
                    "unbroadcastcount": 0,
                    "fullrbf": true,
                }
            }
            if ( command === "getrawmempool" ) {
                node_faker.status = "";
                return [];
            }
            node_faker.status = "";
            return "unknown error";
        } catch ( e ) {
            node_faker.status = "";
            return "unknown error";
        }
    },
    convertTxhexToCoreFormat: async ( txhex, include_txhex ) => {
        var txid = tapscript.Tx.util.getTxid( txhex );
        var midhash = await node_faker.sha256( node_faker.hexToBytes( txhex ) );
        var hash = await node_faker.sha256( node_faker.hexToBytes( midhash ) );
        hash = node_faker.reverseHexString( hash );
        var decoded = tapscript.Tx.decode( txhex );
        var sizes = tapscript.Tx.util.getTxSize( txhex );
        var vin = [];
        decoded.vin.forEach( input => {
            var item = {}
            if ( input.witness.length ) item[ "txinwitness" ] = input.witness;
            item[ "sequence" ] = parseInt( input.sequence, 16 );
            if ( input.txid === "0".repeat( 64 ) ) {
                item[ "coinbase" ] = input.scriptSig;
                vin.push( item );
                return;
            }
            item[ "txid" ] = input.txid;
            item[ "vout" ] = input.vout;
            var scriptsig_hex = typeof input.scriptSig === "object" ? tapscript.Script.fmt.toBytes( input.scriptSig ).hex : input.scriptSig;
            if ( scriptsig_hex === "00" ) scriptsig_hex = "";
            var scriptsig_asm = "";
            if ( scriptsig_hex ) scriptsig_asm = tapscript.Script.decode( scriptsig_hex ).join( " " );
            item.scriptsig = {
                asm: scriptsig_asm,
                hex: scriptsig_hex,
            }
            vin.push( item );
        });
        var vout = [];
        decoded.vout.forEach( ( output, index ) => {
            var type_per_taprootjs = "unknown";
            var address = "unknown";
            var type = "unknown";
            try {
                type_per_taprootjs = tapscript.Address.decode( tapscript.Address.fromScriptPubKey( output.scriptPubKey ) ).type;
                address = tapscript.Address.fromScriptPubKey( output.scriptPubKey );
            } catch ( e ) {}
            if ( type_per_taprootjs === "p2pkh" ) var type = "pubkeyhash";
            if ( type_per_taprootjs === "p2sh" ) var type = "scripthash";
            if ( type_per_taprootjs === "p2w-pkh" ) var type = "witness_v0_keyhash";
            if ( type_per_taprootjs === "p2w-sh" ) var type = "witness_v0_scripthash";
            if ( type_per_taprootjs === "p2tr" ) var type = "witness_v1_taproot";
            var asm = tapscript.Script.fmt.toAsm( output.scriptPubKey ).join( " " );
            if ( asm.startsWith( "OP_RETURN" ) ) {
                var type = "nulldata";
                var address = undefined;
            }
            if ( output.scriptPubKey === "51024e73" ) {
                var type = "anchor";
                var address = "bc1pfeessrawgf";
            }
            var item = {
                value: node_faker.satsToBitcoin( Number( output.value ) ),
                n: index,
                scriptPubKey: {
                    asm,
                    desc: "unknown",
                    hex: output.scriptPubKey,
                    address,
                    type,
                }
            }
            vout.push( item );
        });
        var returnable = {
            "txid": txid,
            "hash": hash,
            "version": decoded.version,
            "size": sizes.size,
            "vsize": sizes.vsize,
            "weight": sizes.weight,
            "locktime": decoded.locktime,
            "vin": vin,
            "vout": vout,
        }
        if ( include_txhex ) returnable.hex = txhex;
        return returnable;
    },
    satsToBitcoin: sats => {
        var btc = String( sats ).padStart( 8, "0" ).slice( 0,-8 ) + "." + String( sats ).padStart( 8, "0" ).slice( -8 );
        if ( btc.endsWith( "00000" ) ) {
            btc = btc.substring( 0, btc.length - 5 );
            var i; for ( i=0; i<5; i++ ) {
                if ( btc.endsWith( "0" ) ) btc = btc.substring( 0, btc.length - 1 );
            }
            if ( btc.endsWith( "." ) ) btc = btc.substring( 0, btc.length - 1 );
            if ( !btc ) btc = 0;
        }
        return Number( btc );
    },
    bitcoinToSats: btc => Math.floor( btc * 100_000_000 ),
    uptimeLoop: async () => {
        await node_faker.waitSomeTime( 1000 );
        node_faker.uptime = node_faker.uptime + 1;
        node_faker.uptimeLoop();
    },
    isValidAddress: address => {
        if ( address === "bc1pfeessrawgf" ) return true;
        try {
            return !!tapscript.Address.decode( address ).script;
        } catch( e ) {return;}
        return;
    },
}

var esplora_servers = [
    `https://mempool.space/api`,
    `https://mempool.guide/api`,
];
var electrum_servers = [
    `wss://horsey.cryptocowboys.net:50004`,
    `wss://btc.electroncash.dk:60004`,
    `wss://bitcoin.grey.pw:50004`,
    `wss://blackie.c3-soft.com:57004`,
    // `wss://electrum.jochen-hoenicke.de:50010`,
];
var electrum_server = electrum_servers[ Math.floor( Math.random() * electrum_servers.length ) ];
var esplora_server = esplora_servers[ Math.floor( Math.random() * esplora_servers.length ) ];
var socket = null;

var sendResponse = ( response, data, statusCode, content_type ) => {
    if ( response.finished ) return;
    response.setHeader( 'Access-Control-Allow-Origin', '*' );
    response.setHeader( 'Access-Control-Request-Method', '*' );
    response.setHeader( 'Access-Control-Allow-Methods', 'OPTIONS, GET, POST' );
    response.setHeader( 'Access-Control-Allow-Headers', '*' );
    response.setHeader( 'Content-Type', content_type[ "Content-Type" ] );
    response.writeHead( statusCode );
    response.end( data );
}

var collectData = ( request, callback ) => {
    var data = '';
    request.on( 'data', ( chunk ) => {
        data += chunk;
    });
    request.on( 'end', () => {
        callback( data );
    });
}

var requestListener = async function( request, response ) {
    var parts = url.parse( request.url, true );
    var $_GET = parts.query;
    if ( request.method === 'POST' ) {
        collectData(request, async formattedData => {
            if ( parts.pathname == "/" || parts.pathname == "" ) {
                var json = JSON.parse( formattedData );
                var command = `${json.method} ${json.params.join( " " )}`;
                var result = await node_faker.processCommand( command );
                var returnable = JSON.stringify({
                  result,
                  "error": null,
                  "id": json.id,
                });
                returnable = returnable + "\n";
                return sendResponse( response, returnable, 200, {'Content-Type': 'application/json'} );
            }
            var html_404 = `
                <p>404 page not found</p>
            `;
            return sendResponse( response, `404 page not found`, 200, {'Content-Type': 'text/html'} );
        });
    }
}

var server = http.createServer( requestListener );
server.listen( 8332 );
node_faker.waitWhenParsingTxs = true;
node_faker.uptimeLoop();
