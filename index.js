var util = require ('util');
var EventEmitter = require ('events').EventEmitter;
var net = require ('net');
var fs = require ('fs');

// Export our class
module.exports = birdbgp;

// birdbgp is an EventEmitter
util.inherits (birdbgp, EventEmitter);

// Local globals
var CODES = {
	'success': {
		'0000': 'OK',
		'0001': 'Welcome',
		'0002': 'Reading configuration',
		'0003': 'Reconfigured',
		'0004': 'Reconfiguration in progress',
		'0005': 'Reconfiguration already in progress, queueing',
		'0006': 'Reconfiguration ignored, shutting down',
		'0007': 'Shutdown ordered',
		'0008': 'Already disabled',
		'0009': 'Disabled',
		'0010': 'Already enabled',
		'0011': 'Enabled',
		'0012': 'Restarted',
		'0013': 'Status report',
		'0014': 'Route count',
		'0015': 'Reloading',
		'0016': 'Access restricted'
	},
	'error': {
		'8000': 'Reply too long',
		'8001': 'Route not found',
		'8002': 'Configuration file error',
		'8003': 'No protocols match',
		'8004': 'Stopped due to reconfiguration',
		'8005': 'Protocol is down => cannot dump',
		'8006': 'Reload failed',
		'8007': 'Access denied',
		'9000': 'Command too long',
		'9001': 'Parse error',
		'9002': 'Invalid symbol type'
	},
	'tables': {
		'1000': 'BIRD version',
		'1001': 'Interface list',
		'1002': 'Protocol list',
		'1003': 'Interface address',
		'1004': 'Interface flags',
		'1005': 'Interface summary',
		'1006': 'Protocol details',
		'1007': 'Route list',
		'1008': 'Route details',
		'1009': 'Static route list',
		'1010': 'Symbol list',
		'1011': 'Uptime',
		'1012': 'Route extended attribute list',
		'1013': 'Show ospf neighbors',
		'1014': 'Show ospf',
		'1015': 'Show ospf interface',
		'1016': 'Show ospf state/topology',
		'1017': 'Show ospf lsadb',
		'1018': 'Show memory'
	},
	'end': {}
};

// The birdbgp "class"
// ============================================================================
function birdbgp (options, callbacks) {
    var self = this;

	// Who's running this party?
	EventEmitter.call (this);

	// Configurable settings
	this.__SETTINGS = {
		// Socket settings
		'path': '/var/run/bird.ctl'
	};
	// Internal state
	this.__INTERNALS = {
		'socket': null,
		'state': 0,
		'buffer': '',
		'command': null,
		'commands': []
	};

	if (isType (options, 'array')) {
		// Loop through all of the settings
		options.forEach (function (value, setting, array) {
			// Check that the setting name exists
			if (this.__SETTINGS [setting] !== undefined) {
				// Set the setting
				this.__SETTINGS [setting] = value;
			}
		});
	}

	if (isType (options, 'object')) {
		// Loop through all of the settings
		Object.keys(options).forEach(function (key) {
			// Check that the setting name exists
			if (self.__SETTINGS [key] !== undefined) {
				// Set the setting
				self.__SETTINGS [key] = options[key];
			}
		});
	}

	if (isType (callbacks, 'array')) {
		// Loop through all of the callbacks
		callbacks.forEach (function (callback, event, array) {
			// Add the event handler
			this.on (event, callback);
		});

	} else {
		callbacks = {};
	}

	if (this.__SETTINGS.path && callbacks.open) {
		// We have a connect callback and a path, CONNECT!
		this.open ();
	}
}

birdbgp.prototype.state = function (state) {
	var stateMap = {
		'closed': 0,
		'open': 1,
		'restrict': 2,
		'ready': 3,
		'waiting': 4,
		0: 'closed',
		1: 'open',
		2: 'restrict',
		3: 'ready',
		4: 'waiting'
	};

	if (state !== undefined) {
		state = state.toLowerCase ();

		if (stateMap [state] !== undefined) {
			if (! state.match (/^\d+$/)) {
				this.__INTERNALS.state = stateMap [state];

			} else {
				this.__INTERNALS.state = state;
			}

		} else {
			console.error ('Error: "' + state + '" is an invalid state');
		}
	}

	// Always return the new/current state
	return (stateMap [this.__INTERNALS.state]);
};

birdbgp.prototype.open = function (options, callback) {
	// For later use
	var self = this;

	if (isType (callback, 'function')) {
		// Add the open callback to EventEmitter
		this.on ('open', callback);
	}

	// Check the path exists
	if (! fs.existsSync (this.__SETTINGS.path)) {
		this.emit ('open', new Error ('Bird socket does not exist at "' + this.__SETTINGS.path + '"'));
		return (null);
	}

	// Check that the path is a UNIX socket
	var socketStat = fs.statSync (this.__SETTINGS.path);
	if (! socketStat || ! socketStat.isSocket ()) {
		this.emit ('open', new Error ('Bird socket at "' + this.__SETTINGS.path + '" is not a socket'));
		return (null);
	}

	// Create a new Socket
	this.__INTERNALS.socket = new net.Socket ();
	// Connect the socket to the path
	this.__INTERNALS.socket.connect (this.__SETTINGS.path, function (err) {
		// Pass any errors back to the caller
		if (err) {
			// Set the state
			self.state ('closed');
			// Remove the socket
			self.__INTERNALS.socket = null;
			// Clear the buffer
			self.__INTERNALS.buffer = '';
			self.__INTERNALS.commands = [];
			
			// Call the open event
			self.emit ('open', err);
			// No mas
			return (null);
		}

		// Set state to open
		self.state ('open');
		// Emit the open event
		self.emit ('open', null);

		// Setup our event handlers
		this.on ('data', function (data) {
			var line, code;
			var command;

			// Dirty dirty dirty
			if (! isType (data, 'string')) {
				data = data.toString ();
			}

			// Append data to the buffer
			self.__INTERNALS.buffer += data;

			// Loop until a break()
			for (;;) {
				// Match for a line
				line = self.__INTERNALS.buffer.match (/^([^\r\n]*)(\r\n|\n\r|\r|\n)/);
				// Did we get one?
				if (! line) {
					// Nope! break()
					break;
				}

				// Strip the line off the beginning of the buffer
				self.__INTERNALS.buffer = self.__INTERNALS.buffer.substr (line [1].length + line [2].length);
				// Set line to the actual content
				line = line [1];
				// Store the line's code
				code = line.substr (0, 4);

				if (code == '0001') {
					// Welcome message
					// Set state to restricted
					self.state ('restrict');
					// Enter restricted mode (unshift() so it's definitely first)
					self.__INTERNALS.commands.unshift ({
						'command': 'restrict',
						'callback': function (err, data) {
							if (err) {
								self.emit ('error', err);
								return (null);
							}

							// Fire the ready event
							self.emit ('ready', null);
						},
						'buffer': ''
					});
					// Fire the next command
					self.__NEXTCOMMAND ();

				} else if (CODES.success [code]) {
					// Single-line response
					// Save the command
					command = self.__INTERNALS.command;
					// Remove the command from current
					self.__INTERNALS.command = null;
					// Call the callback with no error, the code, and the response
					setTimeout(function() { command.callback (null, code, command.buffer); }, 0);
					// Set the state to ready
					self.state ('ready');
					// Try to run another command
					setTimeout(function() {
					    self.__NEXTCOMMAND ();
					}, 0);

				} else if (CODES.error [code]) {
					// Error returned
					// Save the command
					command = self.__INTERNALS.command;
					// Remove the command from current
					self.__INTERNALS.command = null;
					// Call the callback with the error, the code, and the whatever response there may have been before the error
					command.callback (new Error (code + ' ' + CODES.error [code]), code, command.buffer);
					// Set the state to ready
					self.state ('ready');
					
					// Try to run another command
					setTimeout(function() {
					    self.__NEXTCOMMAND ();
					}, 0);

				} else if (code.match (/^[0-9]/)) {
					// Some other code, just append the data
					self.__INTERNALS.command.buffer += line.substr (5) + "\n";

				} else if (code.charAt (0) == ' ') {
					// A space? Just append the data
					self.__INTERNALS.command.buffer += line.substr (1) + "\n";

				} else if (code.charAt (0) == '+') {
					// A + tells us the line will wrap
					self.__INTERNALS.command.buffer += line.substr (1);

				} else {
					console.warn ('Warning: Unparsable string: "' + line + '"');
				}
			}
		});

		this.on ('close', function (err) {
			// Set the state
			self.state ('closed');
			// Remove the socket
			self.__INTERNALS.socket = null;
			// Clear the buffer
			self.__INTERNALS.buffer = '';
			self.__INTERNALS.commands = [];
			
			// Fire our closed event
			self.emit ('close', err);
		});

		self.on ('error', function (err) {
			this.emit ('error', err);
		});
	});
};

birdbgp.prototype.close = function (callback) {
	// You can only close if you're not closed
	if (this.state () != 'closed') {
		// Set state to closed
		this.state ('closed');
		// Destroy the socket
		this.__INTERNALS.socket.destroy ();
	}
};

birdbgp.prototype.command = function (command, callback) {
	// Make sure we have a callback
	if (! isType (callback, 'function')) {
		// Nope! Complain to the console
		console.error ('Error: Callback for birdbgp.command() is not optional');
		// Be done
		return (null);
	}

	// Store the command and callback
	this.__INTERNALS.commands.push ({
		'command': command,
		'callback': callback,
		'buffer': ''
	});

	if (this.state () == 'ready') {
		this.__NEXTCOMMAND ();
	}
};

birdbgp.prototype.__NEXTCOMMAND = function () {
	if (
		(this.state () == 'ready' && this.__INTERNALS.commands [0]) ||
		(this.state () == 'restrict' && this.__INTERNALS.commands [0] && (this.__INTERNALS.commands [0].command == 'restrict'))
	) {
        // We are now busy
        this.state('waiting');
		// Store the command
		this.__INTERNALS.command = this.__INTERNALS.commands.shift ();
		// Write the command
		this.__INTERNALS.socket.write (this.__INTERNALS.command.command + "\n");
	}
};

// Useful wrappers
// ============================================================================
function isType (variable, type) {
	var typeOf;

	if (variable) {
		typeOf = typeof (variable);
		if (typeOf.toLowerCase () === type.toLowerCase ()) {
			return (true);
		}
		if (Object.prototype.toString.call (variable).toLowerCase () === '[object ' + type.toLowerCase () + ']' ) {
			return (true);
		}
	}
	return (false);
}
