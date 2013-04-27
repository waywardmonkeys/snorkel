"use strict";

var filter_helper = require("controllers/query/filters");

var component = require("client/js/component");
var helpers = require("client/views/helpers");
var presenter = require("client/views/presenter");
var views = require("client/js/view");

var _show_controls = false;
var ResultsStore = require("client/js/results_store");


// Window mutation ftw
require("static/scripts/vendor/miuri");

var Throbber = require("client/js/throbber");


var _query_id;
var _query_details;


function get_query_from_str(query_str) {
  var query = $.deparam(query_str);
  var filters = query.filters;

  var fields = [];
  _.each(query, function(val, key) {
    if (_.isString(val)) {
      fields.push({ name: key, value: val });
    }

    if (_.isArray(val)) {
      _.each(val, function(v) { fields.push( {name: key, value: v }); });
    }
  });
  var serialized = {
    data: fields,
    string: query_str
  };

  return serialized;
}

function QueryState() {
  var _loading;
  var _acked;
  var _received;
  var _start;
  var _compare;
  var _results;
  var _should_compare;

  function reset() {
    _loading = null;
    _acked = null;
    _received = null;
    _start = null;
    _should_compare = false;
    _compare = null;
    _results = null;
  }

  function is_finished() {
    var done = _results && (!_should_compare || _compare);
    return done;
  }

  function get_text() {

    // ask meself what's up
    var ret;
    if (_received) {
      ret = "Rendering Results";
    }

    // For the first second, look like we're sending the query to the server :-)
    if (_acked && Date.now() - _start > 1000) {
      ret = "Running Query";
    } else if (_loading) {
      ret = "Uploading Query";
    }

    return $("<h1>")
      .html(ret);

  }

  function handle_results() {
    if (is_finished()) {
      tr.stop();
    }
    _received = true;
    _loading = false;
    _results = true;
  }

  function handle_compare() {
    if (is_finished()) {
      tr.stop();
    }
    _compare = true;
    _received = true;
  }

  function handle_ack() {
    _acked = true;
    _loading = true;
  }

  function handle_new_query() {
    tr.start();
    _loading = true;
    _start = Date.now();
  }

  function should_compare(compare) {
    _should_compare = compare;
  }


  var tr = Throbber.create($("#query_content"), get_text);

  return {
    get_text: get_text,
    got_ack: handle_ack,
    new_query: handle_new_query,
    got_compare: handle_compare,
    got_results: handle_results,
    reset: reset,
    should_compare: should_compare
  };


}

var QS = new QueryState();

function serialized_array_to_str(arr) {

  var form_str = _.map(arr, function(f) { return f.name + "=" + f.value; }).join('&');

  return form_str;
}

// How do we tie query_results and new_query together?
// through the views! (maybe?)
function handle_query_results(data) {
  if (!data) {
    return;
  }

  QS.got_results();

  if (data.error) {
    views.insert_error(data.error);
  } else {
    views.insert_graph(data.parsed.view, data);
    ResultsStore.add_results_data(data);
  }

  QS.reset();
}

function handle_compare_results(data) {
  if (!data) {
    return;
  }

  QS.got_compare();

  if (data.error) {
    views.insert_error(data.error);
  } else {
    ResultsStore.add_compare_data(data);
    views.insert_comparison(data.parsed.view, data);
  }

}

function handle_query_id(data) {
  ResultsStore.identify(data);
}

function handle_query_saved(query_details) {
  var container = $("#query_queue .saved_queries");
  // Psas in the query from above for later re-usage
  $C("query_tile", { query: query_details }, function(tile) {
    tile.$el.hide();
    tile.prependTo(container);
    tile.$el.fadeIn(1000);
  });

  $C("modal", {
    title: "Success!",
    body: "yuor query has been saved. look in your query history for it. <br />" +
          "<small>(Click on your username to see recent &amp; saved queries)</small>"
  });
}

function insert_query_tiles(container, queries, in_order) {
  _.each(queries, function(data) {
    var view_data = views.VIEWS[data.parsed.view];

    if (data.results) {

      ResultsStore.set_timestamp(data.results.query.id, data.updated || data.created);

      if (data.results.query) {
        ResultsStore.add_results_data(data.results.query);
      }

      if (data.results.compare) {
        ResultsStore.add_compare_data(data.results.compare);
      }
    }

    var icon = "noun/view.svg";
    if (view_data) {
      icon = view_data.icon || "noun/view.svg";
    }

    // Psas in the query from above for later re-usage
    $C("query_tile", { query: data, icon: icon }, function(tile) {
      tile.$el.hide();
      if (in_order) {
        tile.appendTo(container);
      } else {
        tile.prependTo(container);
      }
      tile.$el.fadeIn(1000);
    });
  });
}

function handle_query_ack(data) {
  QS.got_ack();
  ResultsStore.handle_ack(data);
  _query_id = data.id;

  QS.should_compare(data.parsed.compare_mode);

  insert_query_tiles($("#query_queue .query_list"), [data]);
}

function handle_new_query() {
  QS.new_query();
}

function load_recent_queries(queries) {
  insert_query_tiles($("#query_queue .query_list"), queries, true);
}

function load_saved_queries(queries) {
  insert_query_tiles($("#query_queue .saved_queries"), queries, true);
}

function load_shared_queries(queries) {
  insert_query_tiles($("#query_queue .shared_queries"), queries, true);
}

module.exports = {
  init: function() {
    // this is initializing component interactions
    jank.controller().on("rename_query", function(query, name, info) {
      jank.socket().emit("save_query", query, name, info);
    });

    jank.controller().on("delete_query", function(query, cb) {
      jank.socket().emit("delete_query", query);
      if (cb) { cb(); }
      // gotta show a little dealie for old queries
    });

    jank.controller().on("refresh_query", function(query) {
      jank.socket().emit("refresh_query", query);
      // gotta show a little dealie for old queries
    });

    jank.controller().on("query_tile_clicked", function(query) {

      // TODO: this should be better encapsulated into a modal hider/shower
      // thats shared across modules
      $("#user_dialog").modal('hide');
      this.toggle_pane(false);

      this.set_dom_from_input(query.input);

      var id = query.id || query.clientid;
      _query_id = id; // hidden variables ahoy
      _query_details = query;

      jank.go("/query?table=" + this.table + "&c=" + id);
      views.redraw(id, query);
    });

    jank.controller().on("swap_panes", function(show_pane) {
      this.toggle_pane(!show_pane);
    });

    var that = this;
    jank.controller().on("switch_views", function(view) {
      that.update_view(view);
    });

    jank.controller().on("set_control", function(key, value) {
      views.set_control(key, value);
    });

    jank.controller().on("hide_compare_filters", function() {
      that.hide_compare_filters();
    });

    jank.controller().on("show_compare_filters", function() {
      that.show_compare_filters();
    });

    jank.subscribe("popstate", function() {
      var form_str = window.location.search.substring(1);
      var data = $.deparam(form_str);
      var id = data.c || data.id;

      that.set_dom_from_query(form_str);

      if (id !== _query_id) {
        _query_id = id;
        _query_details = null;

        // if we dont have a local cache of the ID, then we should probably
        // re-run the query, huh?
        if (!views.redraw(id)) {
          that.run_query(form_str, true);
          // run this query again?
          // TODO: show 'save' button
        }
        // need to restore the old query
      }
    });

    views.set_container($("#query_content"));
    filter_helper.set_container(this.$page);


    var query_str = window.location.search.substring(1);
  },

  run_startup_query: function() {
    var that = this;
    var query_str = window.location.search.substring(1);
    jank.do_when(this.fields, 'query:fields', function() {
      that.run_query(query_str, true);
      that.set_dom_from_query(query_str);
    });

  },

  events: {
    "click .pane_toggle" : "handle_pane_toggle_clicked",
    "click .logout" : "handle_logout",
    "click .compare_filter" : "handle_compare_toggle"
  },

  delegates: {
    // delegate events
    view_changed: function(cmp, evt) {
      var view_selector = cmp.$el.find("select");
      var view = view_selector.val();
      views.update_controls(view);
    },

    // double hmmm
    table_changed: function(cmp) {
      var table_selector = cmp.$el.find("select");
      var table = table_selector.first().val();

      // TODO: do better than just reloading the URL.
      // something more ajaxy, with Backbone's Router
      //
      if (this.table && table != this.table) {
        var uri = new miuri(window.location.pathname);
        uri.query({ 'table' : table});
        window.location = uri;
      }

    },

    save_clicked: function(el) {
      this.save_query();
    },
    share_clicked: function(el) {
      this.share_query();
    },
    go_clicked: function(el) {
      this.run_query();
    }
  },

  get_query_from_dom: function() {
    var formEl = this.$page.find("#query_sidebar form");

    formEl
      .find("[data-disabled=true]")
      .attr("disabled", true);
    var form_data = formEl.serializeArray();

    formEl
      .find("[data-disabled=true]")
      .attr("disabled", false);

    // should we make sure to do some human readable junk before
    // transmitting to server?
    var form_str = serialized_array_to_str(form_data);

    var filter_data = filter_helper.get(this.$page);

    var json_filters = JSON.stringify(filter_data);
    form_str += "&filters=" + json_filters;

    form_data.push({name: "filters", value: json_filters});

    return {
      string: form_str,
      data: form_data,
      filters: filter_data
    };

  },

  load_saved_query: function(obj) {
    var that = this;
    _query_id = obj.clientid;
    _query_details = obj;
    var done = _.after(2, function() {
      handle_query_results(obj.results.query);
      handle_compare_results(obj.results.compare);
      that.set_dom_from_input(obj.input);

      ResultsStore.identify({
        server_id: obj.hashid,
        client_id: obj.clientid
      });

      views.show_query_details(obj.clientid, obj);
    });

    // Gotta wait for certain components...
    component.load("selector", done);
    component.load("multiselect", done);
  },

  set_dom_from_query: function(query_str) {
    var query = $.deparam(query_str);
    var view = query.view;
    this.update_view(view || "samples");

    var formEl = this.$page.find("#query_sidebar form");
    formEl.deserialize(query_str);
    formEl.find(":input[name]").each(function() {
      var val = $(this).val();
      var name = $(this).attr("name");
      if (name === "table" || name === "view") {
        return;
      }

      if ($(this).val()) {
        $(this).val(query[name]);
        $(this).trigger("liszt:updated");
      }
    });

    // deserialization for multiselects. grr.
    var multiselects = this.$page.find("#query_sidebar form select[multiple]");
    multiselects.each(function(m) {
      var name = $(this).attr("name");
      var val = query[name];
      $(this).val(val);
      $(this).trigger("liszt:updated");
    });


    // deserialization for filters, which are JSON
    var filters = {};
    try {
      filters = JSON.parse(query.filters);
    } catch(e) { }

    if (filters.query || filters.compare) {
      var filterEl = this.$page.find("#filters");
      // one level of dependencies?
      jank.do_when(this.fields, 'query:fields', function() {
        filter_helper.empty();
        filter_helper.set(filters);
      });

    }
  },

  show_graph: function() {
    // switching to graph view
    this.toggle_pane(false);

  },

  show_controls: function() {
    // switching to graph view
    this.toggle_pane(true);
  },

  // TODO: add this to controller and use this.$page
  toggle_pane: function(controls_show) {
    // Hmmmmm... need to figure out which way to toggle the panes?
    _show_controls = controls_show;
    var text = "Graph";
    if (!controls_show) {
      text = "Query";
    }

    this.$page.find(".pane_toggle").find(".name").html(text);
    var paneToggle = this.$page.find(".pane_toggle");
    var queryContent = this.$page.find("#query_content");
    var querySidebar = this.$page.find("#query_sidebar");

    if (controls_show) {
      // Need to figure this out
      queryContent
        .removeClass("above")
        .addClass("below");
      querySidebar
        .removeClass("below")
        .addClass("above");

      this.$page.find(".graph_quick_links").hide();
      this.$page.find(".query_quick_links").show();
    } else {
      this.$page.find(".query_quick_links").hide();
      this.$page.find(".graph_quick_links").show();
      querySidebar
        .removeClass("above")
        .addClass("below");
      queryContent
        .removeClass("below")
        .addClass("above");
    }

  },

  handle_logout: function() {
    $.post("/logout", function() {
      $(window.location).attr("href", "/");
    });
  },

  compare_mode: function() {
    var compare = views.get_control("compare");
    if (compare) {
      // if we have time, we are comparing
      return true;
    }

    var filterBox = this.$page.find(".filter_group[data-filter-type=compare]");
    // if the compare filter el is visible, means we are comparing
    return $(filterBox).is(":visible");
  },

  show_compare_filters: function(add_if_empty) {
    var filterBox = this.$page.find(".filter_group[data-filter-type=compare]");
    var compareFilter = this.$page.find(".compare_filter");
    filterBox.show();
    compareFilter.show();

    // If there is no filter row and we want to show comparison filters
    if (!filterBox.find(".filter_row").length && add_if_empty) {
      filter_helper.add_compare(["", "", ""], true);
    }

    compareFilter.html("Remove Comparison Filters");
    var container = filterBox.parents("#query_sidebar");
    container.stop(true).animate({
        scrollTop: filterBox.offset().top - container.offset().top + container.scrollTop()
    }, 1000);

  },

  hide_compare_filters: function() {
    var filterBox = this.$page.find(".filter_group[data-filter-type=compare]");
    var compareFilter = this.$page.find(".compare_filter");
    filterBox.hide();
    compareFilter.html("Add Comparison Filters");
  },

  handle_compare_toggle: _.debounce(function() {
    var filterBox = this.$page.find(".filter_group[data-filter-type=compare]");

    var to_hide = $(filterBox).is(":visible") && filterBox.find(".filter_row").length;

    if (to_hide) {
      this.hide_compare_filters();
    } else {
      this.show_compare_filters(true /* add if empty */);
    }

  }, 50),

  set_dom_from_input: function(input) {
    var that = this;
    jank.do_when(this.fields, 'query:fields', function() {
      var form_str = serialized_array_to_str(input);
      that.set_dom_from_query(form_str);
    });
  },

  socket: function(socket) {
    socket.on("new_query", handle_new_query);
    socket.on("query_ack", handle_query_ack);
    socket.on("query_results", handle_query_results);
    socket.on("compare_results", handle_compare_results);
    socket.on("query_id", handle_query_id);
    socket.on("saved_query", handle_query_saved);

    socket.on("recent_queries", load_recent_queries);
    socket.on("saved_queries", load_saved_queries);
    socket.on("shared_queries", load_shared_queries);

    // TODO: make sure this is for reals.
    var table = $("select[name=table]").first().val();
    socket.emit("get_saved_queries", table);
    socket.emit("get_shared_queries", table);
    socket.emit("get_recent_queries", table);
  },

  set_table: function(table) {
    this.table = table;
  },

  set_fields: function(data) {
    this.fields = data;

    var weight_col;
    _.each(this.fields, function(f) {
      if (f.name === "weight" || f.name === "sample_rate") {
        weight_col = f.name;
      }
    });

    this.weight_col = weight_col;

    filter_helper.set_fields(this.fields);
    helpers.set_fields(this.fields);
    presenter.set_fields(this.fields);
    jank.trigger('query:fields', this.fields);
  },

  get_fields: function() {
    return this.fields;
  },

  update_view: function(view) {
    views.update_controls(view);
  },

  handle_pane_toggle_clicked: _.debounce(function(e) {
    jank.controller().trigger("swap_panes", _show_controls);
  }, 50),

  share_query: function() {
    var table = this.table;
    $C("modal", { title: "Query URL" }, function(cmp) {
      var div = $("<div>");
      var input = $("<input type='text' style='width: 100%' />");
      var uri = window.location.host + window.location.pathname + '?table=' + table + '&c='  + _query_id;

      input.val(uri);
      div.append(input);
      cmp.$el.find(".modal-body").append(div);

      var closeButtonEl = $("<a href='#' class='btn rfloat' data-dismiss='modal'>Close</a>");
      cmp.$el.find(".modal-footer").append(closeButtonEl);

      input.select();

    });
  },

  save_query: function() {
    var query_id = _query_id;
    // TODO: get current query details

    var title, description, edit;
    if (_query_details) {
      edit = true;
      title = _query_details.title;
      description = _query_details.description;
    }

    $C("save_query_modal", { query_id: _query_id, title: title, description: description, edit: edit }, function(cmp) { });
  },

  run_query: function(query_ish, keep_url) {
    _query_details = null;
    var serialized;
    if (!query_ish) {
      serialized = this.get_query_from_dom();
    } else {
      if (_.isString(query_ish)) {
        serialized = get_query_from_str(query_ish);
      } else if (_.isObject(query_ish)) {
        serialized = query_ish;
      }
    }

    if (!keep_url) {
      jank.go("/query?" + serialized.string);
    } else {
      jank.replace("/query?" + serialized.string);

    }

    // TODO: collect filter values, too

    if (this.weight_col) {
      serialized.data.push({ name: 'weight_col', value: this.weight_col});
    }

    var table = $("select[name=table]").first().val();
    serialized.data.push({ name: 'table', value: table});

    jank.socket().emit("new_query", serialized.data);

    this.$page.find("#query_content").empty();

    serialized.data.originated = true;

    // TODO: this should be an optimistic tile, i guess
    handle_new_query(serialized.data);
    this.show_graph();
  }

};
