/* global document:true */

(function ($) {
    "use strict";

    function StyleEditor(el, options){
        this.element = el;
        this.$element = $(el);
        this.options = options;
        this.$refreshButton = this.$element.find('.refresh-styles');
        this.init();
    }

    StyleEditor.prototype = {
        init: function () {
            var self = this;
            self.$element.on("pages.loadresources", function(event) {
                self.loadVariables();
            });

            self.$refreshButton.on("click", function(event) {
                self.refreshStyles();
            });
            self.$element.find('button.style-reset-button').on("click", function(event){
                var $button = $(event.target);
                var $target = $(document.getElementById($button.attr('data-target')));
                $target.val($button.attr('data-reset-value'));
            });

            self.setupCustomEditors();
        },

        _apiLessOverrides: function() {
            var self = this;
            var cssfileCandidate = null;
            var links = $('head > link');
            if( links.length > 0 ) {
                var pathParts = $(links[0]).attr("href").split('/');
                cssfileCandidate = pathParts.pop();
            }
            if( cssfileCandidate ) {
                return self.options.api_less_overrides + "?cssfile=" + cssfileCandidate;
            }
            return self.options.api_less_overrides;
        },

        loadVariables: function() {
            var self = this;
            $.ajax({
                url: self._apiLessOverrides(),
                method: "GET",
                datatype: "json",
                contentType: "application/json; charset=utf-8",
                success: function(resp){
                    var results = resp;
                    if( typeof resp.results !== "undefined" ) {
                        /* We are dealing with a paginator. */
                        results = resp.results;
                    }
                    for( var idx = 0; idx < results.length; ++idx ) {
                        var variable = results[idx];
                        var inp = self.$element.find(
                            '[name="' + variable.name + '"]');
                        if( inp ) {
                            inp.attr("value", variable.value);
                        }
                    }
                },
                error: function(resp) {
                    showErrorMessages(resp);
                }
            });
        },

        setupCustomEditors: function(){
            var self = this;

            // custom color editor
            self.$element.find("[data-dj-style-variable-editor=color]").each(function(){
                var $input = $(this);
                $input.wrap('<div>');
                $input.parent().addClass('input-group')
                var $button = $('<span class="input-group-btn"><a href="#" class="btn btn-default" id="cp4"><span class="glyphicon glyphicon-pencil" aria-hidden="true"></span></a></span>');
                $input.after($button);
                $button.colorpicker({customClass: 'color-picker-widget'}).on('changeColor', function(e) {
                    $input.val(e.color.toHex());
                });

            });


            var styleEditorZIndex = parseInt(self.$element.css('z-index'));
            // make sure color picker is on top of style editor
            $('.color-picker-widget').css('z-index', styleEditorZIndex + 1 + '');
        },
        getLess: function(){
            if( this.options.iframe_view ) {
                return this.options.iframe_view.contentWindow.less;
            }
            return less;
        },
        modifiedVars: function(){
            var formValues = $('#editable-styles-form').serializeArray();

            var modifiedVars = {};
            for(var i = 0; i < formValues.length ; i ++){
                var formElem = formValues[i];
                if ( formElem.value != '' ){
                    modifiedVars[formElem.name] = formElem.value;
                }
            }
            return modifiedVars;
        },
        refreshCss: function(){
            var self = this;
            var less = self.getLess();
            less.refresh(true, self.modifiedVars());
        },
        refreshStyles: function(){
            var self = this;
            var formValues = $('#editable-styles-form').serializeArray();
            var less_variables = []

            for(var i = 0; i < formValues.length ; i ++){
                var formElem = formValues[i];
                if ( formElem.value != '' ){
                    less_variables.push({
                        name: formElem.name,
                        value: formElem.value
                    });
                }
            }

            var less = self.getLess();
            if( typeof less.sheets === "undefined" ) {
                var cssfileCandidate = null;
                var lessUrlCandidate = null;
                var links = $('head > link');
                if( links.length > 0 ) {
                    var pathParts = $(links[0]).attr("href").split('/');
                    cssfileCandidate = pathParts.pop();
                    cssfileCandidate = cssfileCandidate.substr(
                        0, cssfileCandidate.lastIndexOf("."));
                    pathParts = "/static/cache".split('/'); // XXX match less.rootpath
                    if( pathParts[pathParts.length - 1] === 'cache' ) {
                        pathParts.pop(); // remove the cache/ dir.
                    }
                    pathParts.push(cssfileCandidate);
                    pathParts.push(cssfileCandidate + ".less");
                    lessUrlCandidate = pathParts.join('/');
                }
                links = $('head > link[rel="stylesheet/less"]');
                if( links.length === 0 ) {
                    $('head').append('<link rel="stylesheet/less" href="'
                        + lessUrlCandidate + '"/>');
                }
                less.registerStylesheetsImmediately();
            }

            var fileManager = less.environment.fileManagers[0];
            var instanceOptions = jQuery.extend(less.options, {modifyVars: self.modifiedVars()});

            var lesshref = $(less.sheets[0]).attr("href");
            fileManager.loadFile(lesshref, null, instanceOptions,
                                 less.environment, function(e, loadedFile) {

                var data = loadedFile.contents,
                    path = loadedFile.filename,
                    webInfo = loadedFile.webInfo;
                var newFileInfo = {
                    currentDirectory: fileManager.getPath(path),
                    filename: path,
                    rootFilename: path,
                    relativeUrls: instanceOptions.relativeUrls};
                newFileInfo.entryPath = newFileInfo.currentDirectory;
                newFileInfo.rootpath = instanceOptions.rootpath || newFileInfo.currentDirectory;
                instanceOptions.rootFileInfo = newFileInfo;

                less.render(data, instanceOptions, function(err, result) {
                    if( err ) {
                        showErrorMessages(err);
                    } else {
                        $.ajax({
                            url: self.options.api_sitecss,
                            method: "POST",
                            contentType: "text/plain; charset=utf-8",
                            data: result.css,
                            beforeSend: function(xhr, settings) {
                                xhr.setRequestHeader("X-CSRFToken", getMetaCSRFToken());
                                xhr.setRequestHeader("Content-Disposition", "attachment; filename=" + lesshref.substr(0, lesshref.lastIndexOf(".")) + ".css");
                            },
                            success: function(response) {
                                $.ajax({
                                    url: self._apiLessOverrides(),
                                    method: "PUT",
                                    datatype: "json",
                                    contentType: "application/json; charset=utf-8",
                                    data: JSON.stringify(less_variables),
                                    beforeSend: function(xhr, settings) {
                                        xhr.setRequestHeader("X-CSRFToken", getMetaCSRFToken());
                                    },
                                    success: function(response) {
                                        self.refreshCss();
                                    },
                                    error: function(resp) {
                                        showErrorMessages(resp);
                                    }
                                });
                            },
                            error: function(resp) {
                                showErrorMessages(resp);
                            }
                        });
                    }
                });

            });



        }
    };

    $.fn.djstyles = function(options) {
        var opts = $.extend( {}, $.fn.djstyles.defaults, options );
        return this.each(function() {
            if (!$.data(this, "djstyles")) {
                $.data(this, "djstyles", new StyleEditor(this, opts));
            }
        });
    };

    $.fn.djstyles.defaults = {
        api_less_overrides: "/api/less-overrides"
    };

})(jQuery);
