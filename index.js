// Setup basic express server
const express = require('express');
const app = express();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

// Routing
app.use("/node", express.static(path.join(__dirname, 'node_modules')));
app.use("/", express.static(path.join(__dirname, 'public')));

let users = [];

io.on('connection', (socket) => {
  let addedUser = false;
  console.log("connection get")  ;

  // when the client emits 'add user', this listens and executes
  socket.on('join', (name) => {
      console.log("got join");
    if (addedUser) return;
    // store on socket
    socket.name = name;
    addedUser = true;
    users.push({name});
    socket.emit('joined', {
        name: name,
        users: users,
    });
    // echo globally (all clients) that a person has connected
    socket.broadcast.emit('user joined', {
      name: socket.name,
      users: users,
    });
    console.log(users);
  });

  // key, pressed, position
  socket.on('key update', (data) => {
    io.emit('update', {
        name: socket.name,
        ...data,
    });
  });

  socket.on("start game", (data) => {
     console.log("Game start", data);
     io.emit("game started", data);
  });

  socket.on('disconnect', () => {
    console.log("dc", socket.name);
    if (addedUser) {
      users = users.filter(i => i.name !== socket.name);

      // echo globally that this client has left
      socket.broadcast.emit('user left', {
        name: socket.name,
        users: users,
      });
    }
    console.log(users);
  });
});