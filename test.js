var BirdBGP = require ('./');

var bird = new BirdBGP ();
bird.on ('open', function (err) {
	console.log ('Bird:open');
	if (err) {
		console.error ('    ' + err.toString ());
	}
});
bird.on ('ready', function (err) {
	console.log ('Bird:ready');
	if (err) {
		console.error ('    ' + err.toString ());
	}
	bird.command ('show protocols all', function (err, code, data) {
		console.log ('show protocols all = ' + code);
		console.log (data);
		console.log ('');
		bird.command ('show route for 67.215.92.1 all', function (err, code, data) {
			console.log ('show route for 67.215.92.1 all = ' + code);
			console.log (data);
			console.log ('');
		});
	});
	
});
bird.on ('error', function (err) {
	console.log ('Bird:error');
	if (err) {
		console.error ('    ' + err.toString ());
	}
	
});
bird.on ('close', function (err) {
	console.log ('Bird:close');
	if (err) {
		console.error ('    ' + err.toString ());
	}
});

bird.open ();
