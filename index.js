var express = require('express');
var bodyParser = require("body-parser");
var app = express();
var path = require("path");
var http = require('http').Server(app);
var io = require('socket.io');
var Kandy = require('kandy');
var firebase = require('firebase');
var webpush = require('web-push');
var socket = io(http);
var temp = 0;
var connected = false;
var all_chat = [];
var app_title = '';
var all_users = {};
var port = process.env.PORT || 3000;
function handleError(res, reason, message, code) {
  console.log("ERROR: " + reason);
  res.status(code || 500).json({"error": message});
}
http.listen(port, function(){
  console.log('listening on port ' + port);
});

firebase.initializeApp({
  serviceAccount: "siciothackathon-615e2f5c53d6.json",
  databaseURL: "https://siciothackathon.firebaseio.com"
});

// VAPID keys should only be generated only once. 
const vapidKeys = webpush.generateVAPIDKeys();
webpush.setGCMAPIKey('AIzaSyBXg0iMARMAPHsuo6iUPfIrPmUWUgHlDLE');
webpush.setVapidDetails(
  'mailto:nodejs@siciothackathon.iam.gserviceaccount.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

app.use(bodyParser.urlencoded({extended:false}));
app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));
app.use('/bower_components', express.static(__dirname + '/app/bower_components'));
app.use('/nm', express.static(__dirname + '/node_modules'));
app.use('/css', express.static(__dirname + '/public/templates/css'));
app.get('/home', function(req, res){
  res.sendFile(__dirname + '/public/index.html');
});
app.get('/portnumber', function(req, res) {
  res.status(200).json({"port": port});
});
app.post('/sendKandyMsg',function(req,res) {
  console.log(req);
  if(!(req.body && req.body.message)) {
    console.log("the argument was " + req);
    handleError(res, "Invalid Input","You must submit a message!");
  } else {
    console.log("parameters sent were " + req.body);
    var apiKey = "hidden";//hardcoded for testing
    var userId = "hidden";
    var password = "hidden";
    var kandy = new Kandy(apiKey);
    var end_user = "hidden@hidden.com";
    console.log(req.body.message);
    console.log(typeof req.body.message);
    kandy.getUserAccessToken(userId, password, function (data, response) {
        var dataJson = JSON.parse(data);
        console.log(dataJson.result.user_access_token);
        if(dataJson) {
          userAccessToken = dataJson.result.user_access_token;
          kandy.sendIm(userAccessToken, end_user, req.body.message, function (data, response) {
            var dataJson = JSON.parse(data);
            if (dataJson.message == "success") {
                console.log("Sent to " + end_user + ": " + req.body.message);
                res.status(200).json({"msg": "message success"});
            } else {
                res.status(204).json({"msg": "couldn't send message"});
            }
          });
        } else {
          res.status(300).json({"msg": "couldn't get access token"});
        }
    });
  }
});
app.post('/nspCreate',function(req,res) {//to check for the existence of a unique user channel
  console.log("The req is: " + req.body);
  if(!(req.body && req.body.user_id)) {
    handleError(res, "no user information was sent", "please send valid user information");
  } else {
    var user_id = req.body.user_id;
    var spc_msg = "requested namespace " + user_id + " is active ";
    var send_res = function(msg) {
      console.log(msg);
      var num_keys = 0;
      var nsp_msg = "The current namespaces are: ";
      Object.keys(all_users).forEach(function(key) {
        num_keys++;
        nsp_msg += key + " ";
      })
      if(num_keys === 0) {
        nsp_msg += "none";
      }
      console.log(nsp_msg);//monitor the current conversations
      res.status(200).json({"active_socket": true});
    };
    //if namespace socket has not been created,must create now
    all_users[user_id] ? send_res(spc_msg) : initNameSpace(user_id,send_res);
  }
});
app.post('/createNewUser',function(req,res) {
  if(!(req.body && req.body.user_id)) {
    handleError(res, "Invalid Input","You must submit a valid account.");
  } else {
    //need to to handle the logic here
  }
});
app.get('/allUsers/:id',function(req,res) {//get the user account id
  //need to add body here
});
app.get('/testConnection',function(req,res) {
  res.status(200).json({msg: "You are now connected"});
});
app.get('/testing',function(req,res) {
  res.write('hello world');
  res.end();
});
function initNameSpace(user_id,send_res) {
  console.log("creating the namespace " + user_id);
  var spc_name = "/" + user_id;
  var nsp = socket.of(spc_name);
  nsp.total_users = 0;
  nsp.firebaseRef = firebase.database().ref().child('users').child(user_id);
  nsp.subscribers = {};
  nsp.modules = {};
  nsp.firebaseRef.child('subscriptions').once('value', function(snaps) {
    snaps.forEach(function(subscriber){
      var value = subscriber.val();
      nsp.subscribers[value.endpoint] = value;
    });
  });
  nsp.firebaseRef.child('modules').once('value', function(snaps) {
    snaps.forEach(function(module) {
      // Listen for value changes.
      nsp.firebaseRef.child('modules').child(module.key).child('threshold').on('value', function(dataSnapshot){
        console.log("Sending threshold: " + dataSnapshot.val());
          nsp.emit('newThreshold', {"value": dataSnapshot.val(), "key": module.key});
      });
      // Send the current values.
      nsp.firebaseRef.child('modules').child(module.key).child('threshold').once('value', function(dataSnapshot){
        console.log("Sending threshold: " + dataSnapshot.val());
        nsp.emit('newThreshold', {"value": dataSnapshot.val(), "key": module.key});
      });
    });
  });
  nsp.sendPushNotification = function(jsonObj) {
    if (jsonObj) {
      Object.keys(nsp.subscribers).forEach(function(endpoint) {
        webpush.sendNotification(nsp.subscribers[endpoint], JSON.stringify(jsonObj));
      });
    }
  }

  all_users[user_id] = nsp;//hold a reference to this namespace
  nsp.on('connection', function(client){
    console.log('someone connected to namespace ' + user_id);
    this.total_users += 1;
    console.log("the total users in this namespace are " + this.total_users);
    client.on('storeData',function(msg) {//store data for the session
      console.log('storing game ' + msg.game_id);
      nsp.game_id = msg.game_id;
    });
    client.on('gameMessage',function(msg) {//send a message back to the client
      client.emit('newMessage',msg);
    });
    client.on('newMessage', function(msg){//broadcast an update to everyone listening
      console.log('message sent was ' + msg);
      client.broadcast.emit('newMessage',msg);

    });
    client.on('timeoutCheck',function() {//notify the client that user they are still connected
      client.emit('timeoutCheck');
    });
    client.on('disconnect', function(){
      nsp.total_users -= 1;
      console.log('user disconnected there are now ' + nsp.total_users + ' users');
    });
    client.on('notificationSubscription', function(data) {
      if (data) {
        console.log("Notification Subscription: " + JSON.stringify(data));
        nsp.subscribers[data.endpoint] = data;
        webpush.sendNotification(data, JSON.stringify(
          {
            title: "Notification from Tess!",
            message: "We'll start sending you notifications! (:"
          }
        ));
      }
    });
    client.on('sendPushNotification', function(jsonObj) {
        /* jsonObj can contain the following information.
        Refer to https://www.npmjs.com/package/web-push
        A notification has an associated title which is a DOMString.
        A notification has an associated body which is a DOMString.
        A notification has an associated direction which is one of auto, ltr, and rtl.
        A notification has an associated language which is a DOMString representing either a valid BCP 47 language tag or the empty string.
        A notification has an associated tag which is a DOMString.
        A notification has an associated data.
        A notification has an associated timestamp which is a DOMTimeStamp representing the time, in milliseconds since 00:00:00 UTC on 1 January 1970, of the event for which the notification was created.
        */
        Object.keys(nsp.subscribers).forEach(function(endpoint) {
          webpush.sendNotification(nsp.subscribers[endpoint], JSON.stringify(jsonObj));
        });
    });

    // Web clients emit('getBluetoothDevices') to query the pi for surrounding bluetooth devices.
    client.on('getBluetoothDevices', function(){
      client.broadcast.emit('getBluetoothDevices');
    });

    // The Raspberry Pi will emit('receiveBluetoothDevices') passing in a list of bluetooth names. The list will be bounced to the web clients.
    client.on('receiveBluetoothDevices', function(data) {
      // since we have no data... FAKE DATA! :D
      console.log("receiveBluetoothDevices.");
      var data = [{label: "module1"}, {label: "module2"}, {label: "module3"}, {label: "module4"}];
      client.broadcast.emit('receiveBluetoothDevices', data);
    });

    // The web client has chosen a module to add. Sent the module to the Pi.
    client.on('addBluetoothDevice', function(moduleToAdd) {
      nsp.emit('addBluetoothDevice', moduleToAdd);
    });

    // Receive sensor data from pi
    client.on('receivePiSensorData', function(data){
      // { 
      //   hostname: 'b8:27:eb:f7:d0:73',
      //   data: [ { value: 0, label: 'gas' },
      //           { value: 24.700000762939453, label: 'temperature' },
      //           { value: 41.70000076293945, label: 'humidity' } ] 
      // }
      if (data) {
        var timestamp = (new Date()).getTime();
        console.log(data);
        var pidata = (typeof data == "string") ? JSON.parse(data) : data;
        if (pidata.data) {
          var modulesRef = nsp.firebaseRef.child("modules");
          for(var i = 0; i < pidata.data.length; i++) {
            var sensor = pidata.data[i];
            console.log("Sensor label: " + sensor.label);
            console.log("Sensor value: " + sensor.value);
            var sensorRef = modulesRef.child(sensor.label);
            sensorRef.update({
              'devicelabel': sensor.label,
              'currentValue': sensor.value
            });
            sensorRef.child("logs").push({
              "timestamp": timestamp,
              "-timestamp": timestamp * -1,
              "value": sensor.value,
              "triggered": sensor.triggered ? sensor.triggered : false 
            });
            if (sensor.triggered && sensor.message) {
              nsp.sendPushNotification({
                  title: sensor.title ? sensor.title : "Notification from Tess!",
                  message: sensor.message
              });
            }
          }
        }
      }
    });

    // Recieve an image from the pi
    client.on('newImage', function(data) {
      if (data) {
        console.log('received a new image'); // wtf will this look like?
        client.broadcast.emit("newImage",data);
      }
    });

    client.on('getThreshold', function(){
      // Send the current values.
      nsp.firebaseRef.child('modules').once('value', function(snaps) {
        snaps.forEach(function(module) {
          // Send the current values.
          nsp.firebaseRef.child('modules').child(module.key).child('threshold').once('value', function(dataSnapshot){
            console.log("Sending threshold: " + dataSnapshot.val());
            nsp.emit('newThreshold', {"value": dataSnapshot.val(), "key": module.key});
          });
        });
      });
    });
  });
  send_res("requested namespace " + user_id + " has been created.");
}
// socket.on('connection',function(client) {
//   console.log("someone connected");
// });
