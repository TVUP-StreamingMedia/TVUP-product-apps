#!/usr/bin/env perl
# check-rules.pl — Comprueba que unas reglas de Firestore no abren datos sin login.
#
#   perl check-rules.pl firestore.rules
#
# Invariante positivo: cada "allow" lleva condición, y esa condición es "false" o exige
# request.auth, directamente o a través de una función del propio fichero que lo exija.
#   - Con ||, TODAS las ramas deben exigir login (una rama abierta abre la regla).
#   - Con &&, basta con que lo exija una.
#   - No cuentan las negaciones ni "request.auth == null".
# Es un análisis estático y no sustituye a la revisión del PR: si duda, rechaza.
use strict;
use warnings;

my $file = shift or die "Uso: check-rules.pl <firestore.rules>\n";
open my $fh, '<', $file or die "No puedo leer $file\n";
my $src = do { local $/; <$fh> };
close $fh;

$src =~ s{/\*.*?\*/}{ }gs;   # comentarios de bloque
$src =~ s{//[^\n]*}{}g;      # comentarios de línea

# Funciones del fichero: nombre → expresión que devuelven.
my %body;
while ($src =~ /\bfunction\s+(\w+)\s*\([^)]*\)\s*\{(.*?)\}/gs) {
  my ($name, $b) = ($1, $2);
  $body{$name} = $b =~ /.*\breturn\b(.*?);/s ? $1 : 'false';
}

my %auth;   # funciones que exigen login

# Quita los paréntesis que envuelven la expresión entera.
sub pelar {
  my ($e) = @_;
  $e =~ s/^\s+|\s+$//g;
  while ($e =~ /^\(/) {
    my ($d, $cierra) = (0, -1);
    for my $i (0 .. length($e) - 1) {
      my $c = substr($e, $i, 1);
      $d++ if $c eq '(';
      $d-- if $c eq ')';
      if ($d == 0) { $cierra = $i; last }
    }
    last unless $cierra == length($e) - 1;
    $e = substr($e, 1, -1);
    $e =~ s/^\s+|\s+$//g;
  }
  return $e;
}

# Parte la expresión por un operador (|| o &&) de primer nivel.
sub partir {
  my ($e, $op) = @_;
  my @partes;
  my ($d, $ini) = (0, 0);
  for (my $i = 0; $i < length $e; $i++) {
    my $c = substr($e, $i, 1);
    if    ($c eq '(' || $c eq '[') { $d++ }
    elsif ($c eq ')' || $c eq ']') { $d-- }
    elsif ($d == 0 && substr($e, $i, 2) eq $op) {
      push @partes, substr($e, $ini, $i - $ini);
      $ini = $i + 2;
      $i++;
    }
  }
  push @partes, substr($e, $ini);
  return @partes;
}

sub exige_auth {
  my $e = pelar($_[0]);
  my @o = partir($e, '||');
  return (grep { !exige_auth($_) } @o) ? 0 : 1 if @o > 1;
  my @y = partir($e, '&&');
  return (grep { exige_auth($_) } @y) ? 1 : 0 if @y > 1;
  return 0 if $e =~ /^!/ || $e =~ /request\.auth\s*==\s*null/ || $e =~ /==\s*false\b/;
  return 1 if $e =~ /\brequest\.auth\b/;
  for my $fn (grep { $auth{$_} } keys %auth) {
    return 1 if $e =~ /\b\Q$fn\E\s*\(/;
  }
  return 0;
}

# Las funciones pueden llamarse entre sí: se repite hasta que no cambie nada.
my $cambio = 1;
while ($cambio) {
  $cambio = 0;
  for my $fn (keys %body) {
    next if $auth{$fn};
    if (exige_auth($body{$fn})) { $auth{$fn} = 1; $cambio = 1 }
  }
}

my @errores;
my $hay_allow = 0;
while ($src =~ /\ballow\s+([^:;{}]+?)\s*(:\s*if\b(.*?))?;/gs) {
  $hay_allow = 1;
  my ($metodos, $cond) = ($1, $3);
  $metodos =~ s/\s+/ /g;
  if (!defined $cond) {
    push @errores, "allow $metodos sin condición: queda abierto a todo el mundo";
    next;
  }
  (my $c = $cond) =~ s/\s+/ /g;
  next if pelar($c) eq 'false';
  push @errores, "allow $metodos: if$c → no exige login (request.auth)" unless exige_auth($c);
}

push @errores, "no hay ninguna regla 'allow': el fichero no parece unas reglas de Firestore" unless $hay_allow;

if (@errores) {
  print STDERR "  $_\n" for @errores;
  exit 1;
}
exit 0;
