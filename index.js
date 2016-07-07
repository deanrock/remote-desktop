var express = require('express'),
	http = require('http'),
	engine = require('ejs-mate'),
	portfinder = require('portfinder'),
	exec = require('child_process').exec,
	WebSocketServer = require('ws').Server,
	net = require('net'),
	randomstring = require("randomstring"),
	app = express();

// express view engine
app.engine('ejs', engine);
 
app.set('views',__dirname + '/views');
app.set('view engine', 'ejs');

var vnc_password = randomstring.generate(8);

// index page
app.get('/', function(req, res) {
  res.render('index', {
  	'vnc_password': vnc_password
  });
});

app.use(express.static('static'));

app.server = http.createServer(app);
app.server.listen(process.env.PORT || 3000);

// start x11vnc server
portfinder.basePort = 50000;
portfinder.getPort(function (err, port) {
	exec('x11vnc -forever -display :0 -passwd ' + vnc_password + ' -rfbport ' + parseInt(port, 10), function(error, stdout, stderr) {
	    console.log('stdout: ', stdout);
	    console.log('stderr: ', stderr);
	    if (error !== null) {
	        console.log('exec error: ', error);
	    }
	});

	// websocket proxy for VNC

	// select 'binary' or 'base64' subprotocol, preferring 'binary'
	var selectProtocol = function(protocols, callback) {
	    if (protocols.indexOf('binary') >= 0) {
	        callback(true, 'binary');
	    } else if (protocols.indexOf('base64') >= 0) {
	        callback(true, 'base64');
	    } else {
	        console.log("Client must support 'binary' or 'base64' protocol");
	        callback(false);
	    }
	}

	// handle new WebSocket client
	var new_client = function(client) {
	    var clientAddr = client._socket.remoteAddress, log;
	    console.log(client.upgradeReq.url);
	    log = function (msg) {
	        console.log(' ' + clientAddr + ': '+ msg);
	    };
	    log('WebSocket connection');
	    log('Version ' + client.protocolVersion + ', subprotocol: ' + client.protocol);

	    var target = net.createConnection(port,'127.0.0.1', function() {
	        log('connected to target');
	    });
	    target.on('data', function(data) {
	        //log("sending message: " + data);
	        try {
	            if (client.protocol === 'base64') {
	                client.send(new Buffer(data).toString('base64'));
	            } else {
	                client.send(data,{binary: true});
	            }
	        } catch(e) {
	            log("Client closed, cleaning up target");
	            target.end();
	        }
	    });
	    target.on('end', function() {
	        log('target disconnected');
	        client.close();
	    });
	    target.on('error', function() {
	        log('target connection error');
	        target.end();
	        client.close();
	    });

	    client.on('message', function(msg) {
	        //log('got message: ' + msg);
	        if (client.protocol === 'base64') {
	            target.write(new Buffer(msg, 'base64'));
	        } else {
	            target.write(msg,'binary');
	        }
	    });
	    client.on('close', function(code, reason) {
	        log('WebSocket client disconnected: ' + code + ' [' + reason + ']');
	        target.end();
	    });
	    client.on('error', function(a) {
	        log('WebSocket client error: ' + a);
	        target.end();
	    });
	};

	var vnc_ws = new WebSocketServer({
		server: app.server,
		path: "/vnc",
		handleProtocols: selectProtocol
	});
	vnc_ws.on('connection', new_client);
});
