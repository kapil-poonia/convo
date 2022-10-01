const express = require("express"),
    app = express(),
    socket = require("socket.io"),
    path = require("path"),
    mongoose = require("mongoose"),
    env = require("dotenv"),
    bodyParser = require("body-parser"),
    LocalStratergy = require("passport-local"),
    passport = require("passport"),
    middleware = require("./middleware"),
    User = require("./models/user"),
    server = require("http").createServer(app),
    { addUser, getUsers, deleteUser, getRoomUsers } = require("./users/users"),
    rooms = [],
    io = socket(server);
    var session = require('express-session')
var MemoryStore = require('memorystore')(session)
 
env.config();

// app.io = io;
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session(
    {
        secret: process.env.SECRET,
        cookie: { maxAge: 86400000 },
        store: new MemoryStore({
          checkPeriod: 86400000 // prune expired entries every 24h
        }),
        resave: false,
        saveUninitialized: false,
    })
);
//=============================================================
//Passport Configuration
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStratergy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
app.use(function (req, res, next) {
    res.locals.currentUser = req.user;
    next();
});
//=============================================================
//home route
app.get("/", middleware.isLoggedIn, (req, res) => {
    res.render("index", { roomid: "" });
});

app.get("/join/:id", middleware.isLoggedIn, (req, res) => {
    res.render("index", { roomid: req.params.id });
});
//render login page
app.get("/login", (req, res) => {
    res.render("login");
});
//handle login logic
app.post(
    "/login",
    passport.authenticate("local", {
        failureRedirect: "/login",
    }),
    (req, res) => {
        let url = req.session.redirectUrl ? req.session.redirectUrl : "/";
        if (url.indexOf("login") !== -1) url = "/";
        res.redirect(url);
    },
);
//handle sign up logic
app.post("/register", (req, res) => {
    var newUser = new User({
        username: req.body.username,
        first_name: req.body.first_name,
        last_name: req.body.first_name,
    });

    User.register(newUser, req.body.password, (error, user) => {
        if (error) {
            console.log(error.message);
            return res.redirect("/register");
        }
        passport.authenticate("local")(req, res, () => {
            res.redirect("/");
        });
    });
});
//handle logout
app.get("/logout", (req, res) => {
    req.logout();
    res.redirect("back");
});

app.get("/sitemap.xml",  (req, res) => {
    res.sendFile("sitemap.xml", {
        root: path.join(__dirname, "../public"),
    });
});
//render 404 page
app.use(function (req, res) {
    res.status(404).render("404");
});

const port = process.env.PORT || 4000;

server.listen(port, () => console.log(`Listening on ${port}`));
//=============================================================
//Socket configuration

// io.set("transports", ["xhr-polling"]);
// io.set("polling duration", 10);
// let users = [];
// const addUser = (newUser) => {
//     users.push(newUser);
//     console.log("---------------");
//     console.log(users);
// };
// const getUsers = () => {
//     console.log("###############");

//     console.log(users);
//     return users;
// };
const roomExists = (roomName) => {
    const index = rooms.findIndex((room) => room === roomName);
    return index === -1 ? false : true;
};
//  handle socket calls
io.on("connection", (socket) => {
    socket.on("createRoom", ({ handle }) => {
        let roomName = Math.random().toString(36).substr(2, 6);
        while (roomExists(roomName)) {
            roomName = Math.random().toString(36).substr(2, 6);
        }
        const room = {
            roomName: `${roomName}`,
            admin: handle.trim(),
        };
        const data = { handle: handle, room: room };
        rooms.push(room);
        socket.join(room.roomName);
        addUser(socket.id, handle.trim(), room);
        socket.emit("joined", data);
        socket.broadcast.to(room.roomName).emit("newconnection", data);
    });
    socket.on("joinRoom", (data) => {
        const index = rooms.findIndex((room) => room.roomName === data.room);
        if (index !== -1) {
            socket.join(data.room);
            addUser(socket.id, data.handle.trim(), rooms[index]);
            data.room = rooms[index];
            socket.emit("joined", data);
            socket.broadcast.to(data.room.roomName).emit("newconnection", data);
        } else socket.emit("invalidRoom", { message: "Invalid room-id" });
    });
    socket.on("chat", (data) => {
        const user = data.handle.trim();
        const currentUser = getUsers().filter((obj) => obj.id === socket.id);
        if (currentUser.length > 0) {
            data.users = getRoomUsers(currentUser[0].room.roomName);
            io.in(currentUser[0].room.roomName).emit("chat", data);
        }
    });
    socket.on("typing", (data) => {
        const user = data.trim();
        const currentUser = getUsers().filter((obj) => obj.id == socket.id);
        socket.broadcast.to(currentUser[0].room.roomName).emit("typing", data);
    });
    socket.on("leaveRoom", (handle) => {
        const user = deleteUser(socket.id);
        if (user) {
            socket.leave(user.room.roomName);
            socket.emit("left", user);
            socket.broadcast
                .to(user.room.roomName)
                .emit("userDisconnected", user.name);
        }
    });
    socket.on("disconnect", () => {
        const user = deleteUser(socket.id);
        if (user) {
            socket.broadcast
                .to(user.room.roomName)
                .emit("userDisconnected", user.name);
        }
    });
    socket.on("error", (error) => {
        console.log(error);
        socket.emit("error", { message: err });
    });
});
