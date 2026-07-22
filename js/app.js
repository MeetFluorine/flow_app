(function(){
  "use strict";
  var views = ['dashboard','admin','calc'];

  function showView(name){
    views.forEach(function(v){
      var el = document.getElementById('view-' + v);
      if(el) el.classList.toggle('hidden', v !== name);
    });
    document.querySelectorAll('.topnav .navlink').forEach(function(link){
      link.classList.toggle('active', link.dataset.view === name);
    });
    window.location.hash = name;

    if(name === 'dashboard' && window.DashboardView) window.DashboardView.init();
    if(name === 'admin' && window.AdminView) window.AdminView.init();
    if(name === 'calc' && window.CalcView) window.CalcView.init();
  }

  document.querySelectorAll('[data-view]').forEach(function(link){
    link.addEventListener('click', function(e){
      e.preventDefault();
      showView(link.dataset.view);
    });
  });

  var startView = views.indexOf(window.location.hash.replace('#','')) > -1
    ? window.location.hash.replace('#','')
    : 'dashboard';
  showView(startView);
})();
